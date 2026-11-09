import assert from "node:assert/strict";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGoodreadsShelves } from "./goodreads-widget.mjs";
import { fetchReadwiseBooks } from "./readwise-books.mjs";
import { bookMatchMethod } from "./sync-books.mjs";

const root = new URL("../", import.meta.url);
const statePath = new URL("_data/goodreads-readwise-matches.json", root);
const issuesPath = new URL("_data/goodreads-sync-issues.json", root);
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
  const groups = new Map();
  const skip = (book, reason, candidates) => skipped.push({ ...book, reason,
    candidates: candidates.map(({ id, title, author }) => ({ id, title, author })),
  });
  for (const book of source) {
    let target = byId.get(String(matches[book.reviewId]));
    if (matches[book.reviewId] && !target) {
      skip(book, "linked Readwise book is missing", library.filter((entry) => sameBook(entry, book)));
      continue;
    }
    if (!target) {
      const linked = archive.filter((entry) => sameBook(entry, book) && entry.identifiers?.readwiseBooks);
      const candidates = library.filter((entry) => sameBook(entry, book));
      const linkedIds = new Set(linked.map((entry) => entry.identifiers.readwiseBooks));
      const preferred = library.filter((entry) => linkedIds.has(String(entry.id)));
      if (preferred.length === 1) target = preferred[0];
      else if (candidates.length === 1) target = candidates[0];
      else if (candidates.length > 1) {
        skip(book, "ambiguous editions", candidates);
        continue;
      }
    }
    if (!target) {
      const related = library.filter((entry) => ["title-author", "title-prefix-author"].includes(
        bookMatchMethod({ ...entry, title: entry.title || "", author: entry.author || "" }, book),
      ));
      if (related.length) {
        skip(book, "title differs from an existing book", related);
        continue;
      }
      creates.push({ source: book, item: {
        product: { title: book.title, author: book.author }, status: book.status,
        ...(book.rating == null ? {} : { rating: book.rating }),
      } });
      continue;
    }
    if (!groups.has(target.id)) groups.set(target.id, []);
    groups.get(target.id).push({ book, target });
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      for (const { book, target } of group) skip(book, "multiple Goodreads reviews match the same Readwise book", [target]);
      continue;
    }
    const [{ book, target }] = group;
    matches[book.reviewId] = target.id;
    const item = { id: target.id };
    if (target.status !== book.status) item.status = book.status;
    if ((target.rating ?? null) !== book.rating) item.rating = book.rating;
    if (Object.keys(item).length > 1) updates.push({ title: book.title, item });
  }
  return { matches, updates, creates, skipped };
};

const writeJson = async (location, data) => {
  const temporary = new URL(`${location.href}.tmp`);
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporary, location);
};

const reportIssues = async (source, { skipped, updates, creates }, previous) => {
  const observed = new Set(source.map(({ reviewId }) => reviewId));
  const pending = [...previous.filter(({ reviewId }) => !observed.has(reviewId)), ...skipped]
    .sort((left, right) => left.reviewId.localeCompare(right.reviewId));
  await writeJson(issuesPath, pending);
  const message = `Verified ${updates.length} updates and ${creates.length} additions; ${pending.length} books need matching.`;
  console.log(message);
  if (pending.length) {
    const warning = `${pending.length} Goodreads books were left unchanged. See _data/goodreads-sync-issues.json and add confirmed IDs to _data/goodreads-readwise-matches.json.`;
    console.warn(process.env.GITHUB_ACTIONS === "true" ? `::warning title=Books need matching::${warning}` : warning);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/[\\|\[\]`]/g, "\\$&").replace(/[\r\n]+/g, " ");
    const rows = pending.map((book) => `| [${escape(book.title)}](https://www.goodreads.com/review/show/${book.reviewId}) | ${escape(book.reason)} | ${escape(book.candidates.map(({ id, title, author }) => `${id}: ${title} by ${author}`).join("; "))} |`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "## Goodreads sync", "", message, "",
      ...(pending.length ? ["These books stay unchanged while the rest of the library syncs. Confirm a candidate in `_data/goodreads-readwise-matches.json` and rerun.", "", "| Goodreads book | Reason | Possible Readwise matches |", "| --- | --- | --- |", ...rows, ""] : []),
    ].join("\n"));
  }
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
  const previousIssues = JSON.parse(await readFile(issuesPath, "utf8"));
  const plan = planGoodreadsSync(source, library, archive, savedMatches);
  console.log(JSON.stringify({ updates: plan.updates, creates: plan.creates.map(({ source }) => source.title), skipped: plan.skipped }, null, 2));
  if (!process.argv.includes("--apply")) {
    console.log("Dry run only. Pass --apply to update Readwise Books.");
    return;
  }
  await applyGoodreadsSync(plan, token, (matches) => writeJson(statePath, matches));
  const next = await fetchReadwiseBooks(token);
  const unresolved = new Set(plan.skipped.map(({ reviewId }) => reviewId));
  const attempted = source.filter(({ reviewId }) => !unresolved.has(reviewId));
  const repeated = planGoodreadsSync(attempted, next, archive, plan.matches);
  assert.equal(repeated.updates.length + repeated.creates.length + repeated.skipped.length, 0,
    "Readwise Books did not converge after sync.");
  await reportIssues(source, plan, previousIssues);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
