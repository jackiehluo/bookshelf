import assert from "node:assert/strict";
import test from "node:test";

import {
  bookMatchMethod,
  compactBooks,
  decodeEntities,
  mergeBooks,
  mergeReadwise,
  parseGoodreadsCsv,
  parseGoodreadsRss,
  publicBookSlug,
  publicBookRecord,
} from "../scripts/sync-books.mjs";

test("decodes Readwise text fields including null values", () => {
  assert.equal(decodeEntities("Say You&#39;ll Remember Me"), "Say You'll Remember Me");
  assert.equal(decodeEntities(null), "");
});

test("parses visible Goodreads shelf states from a CSV", () => {
  const csv = `Book Id,Title,Author,ISBN13,My Rating,Date Read,Date Added,Bookshelves,Exclusive Shelf
1,"A Book, With a Comma",Ann Author,9781234567890,4,2026/07/31,2026/07/01,,read
2,The Unfinished Book,Dan Writer,,0,,2026/07/30,did-not-finish,did-not-finish
3,Future Book,Pat Person,,0,,2026/08/01,,to-read
4,The Paused Book,Pam Writer,,0,,2026/07/29,,on-hold
5,The Current Book,Chris Reader,,0,,2026/07/28,,currently-reading`;

  const books = parseGoodreadsCsv(csv);
  assert.equal(books.length, 4);
  assert.deepEqual(
    books.map(({ title, status, rating, dateRead, dateAdded }) => ({ title, status, rating, dateRead, dateAdded })),
    [
      { title: "A Book, With a Comma", status: "read", rating: 4, dateRead: "2026-07-31", dateAdded: "2026-07-01" },
      { title: "The Unfinished Book", status: "dnf", rating: null, dateRead: null, dateAdded: "2026-07-30" },
      { title: "The Paused Book", status: "paused", rating: null, dateRead: null, dateAdded: "2026-07-29" },
      { title: "The Current Book", status: "reading", rating: null, dateRead: null, dateAdded: "2026-07-28" },
    ],
  );
});

test("parses the fields used by the public page from Goodreads RSS", () => {
  const rss = `<rss><channel><item>
    <title><![CDATA[The Test Book]]></title>
    <link>https://www.goodreads.com/book/show/42</link>
    <book_id>42</book_id>
    <book_large_image_url>https://images.example/42.jpg</book_large_image_url>
    <author_name>Test Author</author_name>
    <isbn>123456789X</isbn>
    <user_rating>5</user_rating>
    <user_read_at>2026/08/01</user_read_at>
    <user_date_added>2026/07/01</user_date_added>
    <user_shelves>read, favorites</user_shelves>
  </item></channel></rss>`;

  assert.deepEqual(parseGoodreadsRss(rss), [
    {
      id: "goodreads:42",
      title: "The Test Book",
      author: "Test Author",
      status: "read",
      rating: 5,
      dateRead: "2026-08-01",
      dateAdded: "2026-07-01",
      coverUrl: "https://images.example/42.jpg",
      identifiers: { goodreads: "42", isbn: "123456789X", asin: null, readwise: null },
      highlights: [],
    },
  ]);
});

test("upserts imported metadata without discarding existing highlights", () => {
  const existing = [{
    id: "legacy:test-book-test-author",
    title: "The Test Book",
    author: "Test Author",
    status: "read",
    rating: null,
    dateRead: null,
    dateAdded: null,
    coverUrl: null,
    identifiers: { goodreads: null, isbn: null, asin: null, readwise: "7" },
    highlights: [{ id: "9", text: "Keep me" }],
  }];
  const incoming = [{
    ...existing[0],
    id: "goodreads:42",
    rating: 5,
    dateRead: "2026-08-01",
    dateAdded: "2026-07-01",
    identifiers: { goodreads: "42", isbn: "123", asin: null, readwise: null },
    highlights: [],
  }];

  const [merged] = mergeBooks(existing, incoming);
  assert.equal(merged.rating, 5);
  assert.equal(merged.identifiers.readwise, "7");
  assert.equal(merged.identifiers.goodreads, "42");
  assert.deepEqual(merged.highlights, [{ id: "9", text: "Keep me" }]);
});

test("keeps an existing date added when merging Goodreads RSS updates", () => {
  const existing = [{
    id: "goodreads:42",
    title: "The Test Book",
    author: "Test Author",
    status: "dnf",
    dateAdded: "2023-12-01",
    identifiers: { goodreads: "42" },
  }];
  const incoming = [{
    ...existing[0],
    dateAdded: "2026-03-09",
    rating: 4,
  }];

  const [merged] = mergeBooks(existing, incoming, { preserveDateAdded: true });
  assert.equal(merged.dateAdded, "2023-12-01");
  assert.equal(merged.rating, 4);
});

test("uses the shelf-change date when a paused book changes status", () => {
  const existing = [{
    id: "goodreads:42",
    title: "The Test Book",
    author: "Test Author",
    status: "paused",
    dateAdded: "2023-12-01",
    identifiers: { goodreads: "42" },
  }];
  const incoming = [{
    ...existing[0],
    status: "dnf",
    dateAdded: "2026-08-02",
  }];

  const [merged] = mergeBooks(existing, incoming, { preserveDateAdded: true });
  assert.equal(merged.status, "dnf");
  assert.equal(merged.dateAdded, "2026-08-02");
});

test("matches subtitle and series variants only when authors agree", () => {
  const goodreads = {
    title: "Difficult Conversations: How to Discuss What Matters Most",
    author: "Douglas Stone, Bruce Patton, Sheila Heen",
    identifiers: {},
  };

  assert.equal(
    bookMatchMethod(goodreads, { title: "Difficult Conversations", author: "Douglas Stone", identifiers: {} }),
    "title-author",
  );
  assert.equal(
    bookMatchMethod(goodreads, { title: "Difficult Conversations (Second Edition)", author: "Someone Else", identifiers: {} }),
    null,
  );
  assert.equal(
    bookMatchMethod(
      { title: "A Shared Title: One Subtitle", author: "Alice Smith and Bob Jones", identifiers: {} },
      { title: "A Shared Title", author: "Carol Brown and David White", identifiers: {} },
    ),
    null,
  );
});

test("matches an existing Readwise identifier before comparing titles", () => {
  assert.equal(
    bookMatchMethod(
      { title: "美国反对美国", author: "Wang Huning", identifiers: { readwise: "50491244" } },
      { title: "America Against America", author: "Wang Huning", identifiers: { readwise: "50491244" } },
    ),
    "readwise",
  );
});

test("matches conservative title prefixes and volume suffixes", () => {
  assert.equal(
    bookMatchMethod(
      { title: "This Is It and Other Essays on Zen and Spiritual Experience", author: "Alan W. Watts", identifiers: {} },
      { title: "This Is It", author: "Alan Watts", identifiers: {} },
    ),
    "title-prefix-author",
  );
  assert.equal(
    bookMatchMethod(
      { title: "The History of Sexuality, Volume 1: An Introduction", author: "Michel Foucault", identifiers: {} },
      { title: "The History of Sexuality", author: "Michel Foucault", identifiers: {} },
    ),
    "title-author",
  );
});

test("prefers an exact title over an earlier prefix candidate", () => {
  const existing = [
    { title: "Foundation and Empire", author: "Isaac Asimov", identifiers: {}, rating: 2 },
    { title: "Foundation", author: "Isaac Asimov", identifiers: {}, rating: 3 },
  ];
  const incoming = { title: "Foundation", author: "Isaac Asimov", identifiers: {}, rating: 5 };

  const merged = mergeBooks(existing, [incoming]);
  assert.equal(merged[0].rating, 2);
  assert.equal(merged[1].rating, 5);
});

test("does not merge distinct Goodreads books through a title prefix", () => {
  const existing = [{
    id: "goodreads:1",
    title: "Foundation",
    author: "Isaac Asimov",
    identifiers: { goodreads: "1" },
  }];
  const incoming = {
    id: "goodreads:2",
    title: "Foundation and Empire",
    author: "Isaac Asimov",
    identifiers: { goodreads: "2" },
  };

  assert.equal(mergeBooks(existing, [incoming]).length, 2);
});

test("does not treat a sequel numeral as a title suffix", () => {
  assert.equal(
    bookMatchMethod(
      { title: "American Royals (American Royals, #1)", author: "Katharine McGee", identifiers: {} },
      { title: "American Royals II", author: "Katharine McGee", identifiers: {} },
    ),
    null,
  );
});

test("combines duplicate Readwise highlights without replacing first-edition metadata", () => {
  const books = [{
    title: "Binti (Binti, #1)",
    author: "Nnedi Okorafor",
    coverUrl: null,
    identifiers: { goodreads: "1", isbn: "goodreads-isbn", asin: null, readwise: null },
    highlights: [],
  }];
  const readwiseBooks = [
    {
      title: "Binti",
      author: "Nnedi Okorafor",
      coverUrl: "first-cover",
      identifiers: { isbn: "first-isbn", asin: "first-asin", readwise: "1" },
      highlights: [{ id: "1", text: "First" }],
    },
    {
      title: "Binti",
      author: "Nnedi Okorafor",
      coverUrl: "second-cover",
      identifiers: { isbn: "second-isbn", asin: "second-asin", readwise: "2" },
      highlights: [{ id: "2", text: "Second" }],
    },
  ];

  const result = mergeReadwise(books, readwiseBooks);
  assert.equal(result.matched, 2);
  assert.equal(result.matchedBooks, 1);
  assert.equal(books[0].coverUrl, "first-cover");
  assert.equal(books[0].identifiers.isbn, "goodreads-isbn");
  assert.equal(books[0].identifiers.asin, "first-asin");
  assert.equal(books[0].identifiers.readwise, "1");
  assert.deepEqual(books[0].highlights.map(({ id }) => id), ["1", "2"]);
});

test("replaces stale highlights on the first Readwise match", () => {
  const books = [{
    title: "The Test Book",
    author: "Test Author",
    identifiers: { readwise: "1" },
    highlights: [{ id: "old", text: "Deleted in Readwise" }],
  }];
  const readwiseBooks = [{
    title: "The Test Book",
    author: "Test Author",
    identifiers: { readwise: "1" },
    highlights: [],
  }];

  mergeReadwise(books, readwiseBooks);
  assert.deepEqual(books[0].highlights, []);
});

test("uses an explicit Readwise override for translated titles", () => {
  const books = [{
    id: "goodreads:58844127",
    title: "美国反对美国",
    author: "Wang Huning",
    coverUrl: null,
    identifiers: { goodreads: "58844127", readwise: null },
    highlights: [],
  }];
  const readwiseBooks = [{
    title: "America Against America",
    author: "Wang Huning",
    coverUrl: "reader-cover",
    identifiers: { readwise: "50491244" },
    highlights: [{ id: "1", text: "A PDF highlight" }],
  }];

  const result = mergeReadwise(books, readwiseBooks, { "50491244": "goodreads:58844127" });
  assert.equal(result.methods.override, 1);
  assert.equal(books[0].identifiers.readwise, "50491244");
  assert.equal(books[0].coverUrl, "reader-cover");
  assert.deepEqual(books[0].highlights, [{ id: "1", text: "A PDF highlight" }]);
});

test("removes unused Readwise highlight metadata from the source archive", () => {
  const [book] = compactBooks([{
    title: "The Test Book",
    url: "https://www.goodreads.com/book/show/42",
    highlights: [{
      id: "1",
      text: "Keep this",
      note: null,
      location: "page 3",
      highlightedAt: "2026-08-01T00:00:00Z",
    }],
  }]);

  assert.deepEqual(book.highlights, [{ id: "1", text: "Keep this" }]);
  assert.equal("url" in book, false);
});

test("builds lightweight public book records with a separate highlight path", () => {
  const record = publicBookRecord({
    id: "goodreads:42",
    title: "The Test Book",
    author: "Test Author",
    legacy: { source: "original-bookshelf", order: 7 },
    identifiers: { goodreads: "42", readwise: "7" },
    highlights: [{ id: "1", text: "Keep the catalog light" }],
  });

  assert.deepEqual(record, {
    title: "The Test Book",
    author: "Test Author",
    slug: "the-test-book",
    legacy: { order: 7 },
    highlightCount: 1,
    highlightsPath: "static/data/highlights/the-test-book.json",
  });
});

test("creates readable public slugs without service identifiers", () => {
  assert.equal(
    publicBookSlug({
      title: "The Strength of the Few (Hierarchy, #2)",
      author: "James Islington",
    }),
    "the-strength-of-the-few",
  );
  assert.equal(
    publicBookSlug({ title: "美国反对美国", author: "Wang Huning" }),
    "美国反对美国",
  );
});
