const apiRoot = "https://readwise.io/books/api/v1/books";
const shelfStatus = { finished: "read", currently_reading: "reading", did_not_finish: "dnf" };
const excludedShelves = new Set(["want_to_read", "unsorted", "deleted"]);
const date = (value) => value?.slice(0, 10) || null;

export const fetchReadwiseBooks = async (token) => {
  const books = [];
  const visited = new Set();
  let next = `${apiRoot}?limit=1000`;
  while (next) {
    const url = new URL(next);
    if (url.origin !== "https://readwise.io" || url.pathname !== "/books/api/v1/books" || visited.has(url.href)) {
      throw new Error("Invalid Readwise Books pagination URL.");
    }
    visited.add(url.href);
    const response = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Readwise Books returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.results) || (data.next != null && typeof data.next !== "string")) {
      throw new Error("Invalid Readwise Books response.");
    }
    books.push(...data.results);
    next = data.next;
  }
  return books;
};

export const parseReadwiseBooks = (books) => books.flatMap((book) => {
  if (excludedShelves.has(book.status)) return [];
  const status = shelfStatus[book.status];
  if (!status) throw new Error(`Unknown Readwise Books status: ${book.status}`);
  const title = book.title || book.product?.title;
  if (!book.id || typeof title !== "string" || !title.trim()) {
    throw new Error("Readwise Books entry is missing an id or title.");
  }
  return [{
    id: `readwise-books:${book.id}`,
    title: title.trim(),
    author: book.author || book.product?.author || "",
    status,
    rating: book.rating ?? null,
    dateRead: date(book.finished_reading_at),
    dateAdded: date(book.status_changed_at || book.created),
    coverUrl: book.product?.cover_url || null,
    identifiers: {
      readwiseBooks: String(book.id),
      isbn: book.product?.isbn || null,
      asin: book.product?.asin || null,
    },
    highlights: [],
  }];
});
