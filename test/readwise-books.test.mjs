import assert from "node:assert/strict";
import test from "node:test";
import { mergeReadwiseBooks, publicBookRecord } from "../scripts/sync-books.mjs";
import { parseReadwiseBooks, fetchReadwiseBooks } from "../scripts/readwise-books.mjs";

const existing = {
  id: "goodreads:42", title: "Binti (Binti, #1)", author: "Nnedi Okorafor",
  status: "read", rating: 3, dateRead: "2021-02-03", dateAdded: "2021-01-01",
  coverUrl: "original.jpg", identifiers: { goodreads: "42", asin: "first" },
  highlights: [{ id: "1", text: "Keep this highlight" }],
};
const incoming = {
  id: "readwise-books:7", title: "Binti", author: "Nnedi Okorafor",
  status: "read", rating: 4, dateRead: "2021-02-04", dateAdded: "2026-10-28",
  coverUrl: "imported.jpg", identifiers: { readwiseBooks: "7", asin: "first" }, highlights: [],
};

test("preserves archive identities and historical metadata across repeated imports", () => {
  const first = mergeReadwiseBooks([existing], [incoming]);
  assert.equal(first[0].id, existing.id);
  assert.equal(first[0].title, existing.title);
  assert.equal(first[0].rating, 3);
  assert.equal(first[0].dateRead, "2021-02-03");
  assert.equal(first[0].dateAdded, "2021-01-01");
  assert.equal(first[0].coverUrl, "original.jpg");
  assert.deepEqual(first[0].highlights, existing.highlights);
  assert.deepEqual(mergeReadwiseBooks(first, [incoming]), first);

  const [updated] = mergeReadwiseBooks(first, [{ ...incoming, rating: null, dateRead: "2026-10-30" }]);
  assert.equal(updated.rating, null);
  assert.equal(updated.dateRead, "2026-10-30");
  assert.equal(publicBookRecord(updated).slug, publicBookRecord(existing).slug);
  assert.equal("sourceState" in publicBookRecord(updated), false);
});

test("uses explicit edition matches instead of merging a sequel into the first book", () => {
  const sequel = { ...existing, id: "goodreads:43", title: "Home (Binti, #2)", identifiers: {} };
  const imported = { ...incoming, title: "Binti: Home", identifiers: { readwiseBooks: "7" } };
  const books = mergeReadwiseBooks([existing, sequel], [imported], { 7: sequel.id });
  assert.equal(books[0].identifiers.readwiseBooks, undefined);
  assert.equal(books[1].identifiers.readwiseBooks, "7");
  assert.throws(() => mergeReadwiseBooks([existing], [imported], { 7: sequel.id }), /missing.*goodreads:43/i);
});

test("does not treat a new sequel subtitle as the original book", () => {
  const sequel = { ...incoming, title: "Binti: The Night Masquerade", identifiers: { readwiseBooks: "9" } };
  assert.equal(mergeReadwiseBooks([existing], [sequel]).length, 2);
});

test("chooses the populated duplicate and keeps that binding on later syncs", () => {
  const sparse = { ...incoming, id: "readwise-books:8", rating: null, dateRead: null, identifiers: { readwiseBooks: "8" } };
  const first = mergeReadwiseBooks([existing], [sparse, incoming]);
  assert.equal(first.length, 1);
  assert.equal(first[0].identifiers.readwiseBooks, "7");
  const changed = { ...incoming, rating: null, dateRead: null };
  const next = mergeReadwiseBooks(first, [sparse, changed]);
  assert.equal(next[0].identifiers.readwiseBooks, "7");
  assert.equal(next[0].rating, null);
});

test("reads metadata without publishing wanted, unsorted, or deleted books", () => {
  const raw = {
    id: 7, title: "A Book", author: "A Writer", status: "finished", rating: 4.5,
    finished_reading_at: "2026-10-23T00:00:00Z", status_changed_at: "2026-10-23T00:00:00Z",
    created: "2026-10-28T00:00:00Z", product: null,
  };
  const books = parseReadwiseBooks([raw, ...["want_to_read", "unsorted", "deleted"].map(status => ({ ...raw, status }))]);
  assert.equal(books.length, 1);
  assert.equal(books[0].dateRead, "2026-10-23");
  assert.equal(books[0].rating, 4.5);
  assert.equal(books[0].coverUrl, null);
  assert.equal(books[0].identifiers.readwiseBooks, "7");
  assert.throws(() => parseReadwiseBooks([{ ...raw, status: "unexpected" }]), /status/i);
});

test("retains paused and unmatched archive books", () => {
  const paused = { ...existing, status: "paused" };
  assert.deepEqual(mergeReadwiseBooks([paused], []), [paused]);
});

test("uses the source shelf-change date for a status change", () => {
  const reading = { ...existing, status: "reading" };
  const stopped = { ...incoming, status: "dnf", dateAdded: "2026-10-20" };
  const [updated] = mergeReadwiseBooks([reading], [stopped]);
  assert.equal(updated.status, "dnf");
  assert.equal(updated.dateAdded, "2026-10-20");
});

test("fetches all pages and refuses to forward credentials to another host", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return Response.json({ results: [{ id: calls.length }], next: calls.length === 1 ? "https://readwise.io/books/api/v1/books?cursor=two" : null });
  });
  assert.deepEqual(await fetchReadwiseBooks("test-token"), [{ id: 1 }, { id: 2 }]);
  assert.equal(calls.length, 2);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ results: [], next: "https://other.example/books" }));
  await assert.rejects(fetchReadwiseBooks("test-token"), /pagination/i);
});
