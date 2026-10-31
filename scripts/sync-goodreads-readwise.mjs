import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGoodreadsShelves } from "./goodreads-widget.mjs";
import { fetchReadwiseBooks } from "./readwise-books.mjs";
import { bookMatchMethod } from "./sync-books.mjs";

const root = new URL("../", import.meta.url);
const statePath = new URL("_data/goodreads-readwise-matches.json", root);
const normalize = (s) => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const titleKey = (s) => normalize((s || "").replace(/(?:\s*\([^()]*\)\s*)+$/, ""));
const authorKey = (s) => normalize(s).split(" ").sort().join(" ");
const sameBook = (left, right) => titleKey(left.title) === titleKey(right.title)
  && authorKey(left.author) === authorKey(right.author);

export const planGoodreadsSync = (source, library, archive, savedMatches = {}) => {
  const matches = { ...savedMatches };
  const updates = [], creates = [], skipped = [];
  const byId = new Map(library.map((book) => [String(book.id), book]));
  const claimed = new Map();
  for (const book of source) {
    let target = byId.get(String(matches[book.reviewId]));
    if (matches[book.reviewId] && !target) throw new Error(`Missing linked Readwise book for ${book.title}.`);
    if (!target) {
      const linked = archive.filter((entry) => sameBook(entry, book) && entry.identifiers?.readwiseBooks);
      const candidates = library.filter((entry) => sameBook(entry, book));
      const linkedIds = new Set(linked.map((entry) => entry.identifiers.readwiseBooks));
      const preferred = library.filter((entry) => linkedIds.has(String(entry.id)));
      if (preferred.length === 1) target = preferred[0];
      else if (candidates.length === 1) target = candidates[0];
      else if (candidates.length > 1) {
        skipped.push({ title: book.title, reason: "ambiguous editions", reviewId: book.reviewId });
        continue;
      }
    }
    if (!target) {
      const related = library.some((entry) => ["title-author", "title-prefix-author"].includes(
        bookMatchMethod({ ...entry, title: entry.title || "", author: entry.author || "" }, book),
      ));
      if (related) {
        skipped.push({ title: book.title, reason: "title differs from an existing book", reviewId: book.reviewId });
        continue;
      }
      creates.push({ source: book, item: {
        product: { title: book.title, author: book.author }, status: book.status,
        ...(book.rating == null ? {} : { rating: book.rating }),
      } });
      continue;
    }
    if (claimed.has(target.id)) throw new Error(`Multiple Goodreads reviews match Readwise book ${target.id}.`);
    claimed.set(target.id, book.reviewId);
    matches[book.reviewId] = target.id;
    const item = { id: target.id };
    if (target.status !== book.status) item.status = book.status;
    if ((target.rating ?? null) !== book.rating) item.rating = book.rating;
    if (Object.keys(item).length > 1) updates.push({ title: book.title, item });
  }
  return { matches, updates, creates, skipped };
};

const mutateBooks = async (token, method, items) => {
  const response = await fetch("https://readwise.io/books/api/v1/books", {
    method, headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items }), redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Readwise Books ${method} returned ${response.status}.`);
  const data = await response.json();
  assert.equal(data.results?.length, items.length, "Incomplete Readwise Books mutation response.");
  for (const [index, result] of data.results.entries()) {
    assert.ok(!result.error && (method === "PATCH" ? result.status === "updated" && result.id === items[index].id
      : ["created", "existing"].includes(result.status) && Number.isInteger(result.book_id)),
    `Readwise Books ${method} item ${index} failed: ${result.error?.code || result.status}`);
  }
  return data.results;
};

export const applyGoodreadsSync = async (plan, token, saveMatches) => {
  await saveMatches(plan.matches);
  for (let offset = 0; offset < plan.updates.length; offset += 100) {
    await mutateBooks(token, "PATCH", plan.updates.slice(offset, offset + 100).map(({ item }) => item));
  }
  for (let offset = 0; offset < plan.creates.length; offset += 10) {
    const batch = plan.creates.slice(offset, offset + 10);
    const results = await mutateBooks(token, "POST", batch.map(({ item }) => item));
    for (const [index, result] of results.entries()) plan.matches[batch[index].source.reviewId] = result.book_id;
    await saveMatches(plan.matches);
  }
};

const main = async () => {
  const { GOODREADS_USER_ID: userId, READWISE_TOKEN: token } = process.env;
  if (!userId || !token) throw new Error("Set GOODREADS_USER_ID and READWISE_TOKEN.");
  const source = await fetchGoodreadsShelves(userId);
  const library = await fetchReadwiseBooks(token);
  const archive = JSON.parse(await readFile(new URL("_data/books.json", root), "utf8")).books;
  const savedMatches = JSON.parse(await readFile(statePath, "utf8"));
  const plan = planGoodreadsSync(source, library, archive, savedMatches);
  console.log(JSON.stringify({ updates: plan.updates, creates: plan.creates.map(({ source }) => source.title), skipped: plan.skipped }, null, 2));
  if (!process.argv.includes("--apply")) {
    console.log("Dry run only. Pass --apply to update Readwise Books.");
    return;
  }
  if (plan.skipped.length) throw new Error(`${plan.skipped.length} Goodreads books need explicit edition matches.`);
  await applyGoodreadsSync(plan, token, async (matches) => {
    const content = `${JSON.stringify(matches, null, 2)}\n`;
    const temporary = new URL(`${statePath.href}.tmp`);
    await writeFile(temporary, content);
    await rename(temporary, statePath);
  });
  const next = await fetchReadwiseBooks(token);
  const repeated = planGoodreadsSync(source, next, archive, plan.matches);
  assert.equal(repeated.updates.length + repeated.creates.length, 0, "Readwise Books did not converge after sync.");
  console.log(`Verified ${plan.updates.length} updates and ${plan.creates.length} additions in Readwise Books.`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
