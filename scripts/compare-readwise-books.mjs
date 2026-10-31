import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchReadwiseBooks, parseReadwiseBooks } from "./readwise-books.mjs";
import { mergeReadwiseBooks, publicBookSlug } from "./sync-books.mjs";

const root = new URL("../", import.meta.url);
const current = JSON.parse(await readFile(new URL("_data/books.json", root), "utf8")).books;
const overrides = JSON.parse(await readFile(new URL("_data/readwise-books-matches.json", root), "utf8"));
const snapshotPath = process.argv[2];
if (!snapshotPath && !process.env.READWISE_TOKEN) {
  throw new Error("Set READWISE_TOKEN or pass a saved Readwise Books library JSON file.");
}
const library = snapshotPath
  ? JSON.parse(await readFile(snapshotPath, "utf8"))
  : await fetchReadwiseBooks(process.env.READWISE_TOKEN);
const tracked = parseReadwiseBooks(library);
const merged = mergeReadwiseBooks(current, tracked, overrides);
assert.deepEqual(mergeReadwiseBooks(merged, tracked, overrides), merged, "Repeated imports must not change the result.");
const byId = new Map(merged.map((book) => [book.id, book]));
assert.equal(byId.size, merged.length, "Book IDs must stay unique.");
for (const book of current) {
  const next = byId.get(book.id);
  assert.ok(next, `Missing archived book: ${book.title}`);
  assert.equal(publicBookSlug(next), publicBookSlug(book), `Changed URL: ${book.title}`);
  assert.deepEqual(next.highlights, book.highlights, `Changed highlights: ${book.title}`);
  if (!book.sourceState?.readwiseBooks && book.dateRead) {
    assert.equal(next.dateRead, book.dateRead, `Changed historical date: ${book.title}`);
  }
}
const oldIds = new Set(current.map(({ id }) => id));
const linkedIds = new Set(merged.map((book) => book.identifiers?.readwiseBooks));
const summarize = ({ id, title, status, dateRead, rating }) => ({ id, title, status, dateRead, rating });
console.log(JSON.stringify({
  archive: fileURLToPath(new URL("_data/books.json", root)),
  libraryEntries: library.length,
  trackedEntries: tracked.length,
  linkedBooks: merged.filter((book) => book.identifiers?.readwiseBooks).length,
  duplicateEntries: tracked.filter((book) => !linkedIds.has(book.identifiers.readwiseBooks)).map(summarize),
  archiveBooks: current.length,
  resultingBooks: merged.length,
  added: merged.filter(({ id }) => !oldIds.has(id)).map(summarize),
  changed: current.flatMap((book) => {
    const next = byId.get(book.id);
    return JSON.stringify(summarize(book)) === JSON.stringify(summarize(next))
      ? [] : [{ before: summarize(book), after: summarize(next) }];
  }),
  checks: "Archive IDs, URLs, highlights, historical dates, and repeatability passed.",
}, null, 2));
