import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchReadwiseBooks, parseReadwiseBooks } from "./readwise-books.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "_data/books.json");
const catalogPath = path.join(root, "static/data/catalog.json");
const highlightsDirectory = path.join(root, "static/data/highlights");
const readwiseMatchesPath = path.join(root, "_data/readwise-matches.json");
const readwiseBooksMatchesPath = path.join(root, "_data/readwise-books-matches.json");
const formativeWorksPath = path.join(root, "_data/formative-works.json");

export const decodeEntities = (value = "") =>
  String(value ?? "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();

const normalizeDate = (value = "") => {
  const match = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const normalizeText = (value = "") =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const withoutSeries = (value) => value.replace(/(?:\s*\([^()]*\)\s*)+$/, "");

const normalizeTitle = (value = "") =>
  normalizeText(
    withoutSeries(value)
      .replace(/,\s*volume\s+\d+.*$/i, "")
      .split(":", 1)[0],
  );

const authorsMatch = (left = "", right = "") => {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const ignoredTokens = new Set(["and", "the", "with"]);
  const significantTokens = (value) =>
    value.split(" ").filter((token) => token.length > 2 && !ignoredTokens.has(token));
  const rightTokens = new Set(significantTokens(normalizedRight));
  return significantTokens(normalizedLeft).some((token) => rightTokens.has(token));
};

const normalizeIsbn = (value = "") => value.replace(/[^0-9X]/gi, "").toUpperCase();

const statusFromShelves = (value = "") => {
  const shelves = value.toLowerCase().split(/[,|]/).map((shelf) => shelf.trim());
  if (shelves.some((shelf) => ["did-not-finish", "dnf", "stopped", "abandoned"].includes(shelf))) return "dnf";
  if (shelves.includes("on-hold")) return "paused";
  if (shelves.includes("currently-reading")) return "reading";
  if (shelves.includes("read")) return "read";
  return null;
};

const parseCsv = (input) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted && character === '"' && input[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers = [], ...values] = rows;
  return values.map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index]?.trim() || ""])));
};

export const parseGoodreadsCsv = (csv) =>
  parseCsv(csv)
    .map((row) => {
      const shelves = [row["Exclusive Shelf"], row.Bookshelves].filter(Boolean).join(",");
      const status = statusFromShelves(shelves);
      if (!status) return null;
      const goodreadsId = row["Book Id"];
      return {
        id: goodreadsId ? `goodreads:${goodreadsId}` : `book:${normalizeText(`${row.Title}-${row.Author}`)}`,
        title: row.Title,
        author: row.Author,
        status,
        rating: Number(row["My Rating"]) || null,
        dateRead: normalizeDate(row["Date Read"]),
        dateAdded: normalizeDate(row["Date Added"]),
        coverUrl: null,
        identifiers: {
          goodreads: goodreadsId || null,
          isbn: normalizeIsbn(row.ISBN13 || row.ISBN) || null,
          asin: null,
          readwise: null,
        },
        highlights: [],
      };
    })
    .filter(Boolean);

export const fetchReadwise = async (token) => {
  const books = [];
  let cursor = null;

  do {
    const url = new URL("https://readwise.io/api/v2/export/");
    if (cursor) url.searchParams.set("pageCursor", cursor);
    const response = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (!response.ok) throw new Error(`Readwise returned ${response.status}`);
    const data = await response.json();
    books.push(...(data.results || []));
    cursor = data.nextPageCursor || null;
  } while (cursor);

  return books
    // Reader imports PDFs as articles. Unmatched articles remain excluded from the shelf.
    .filter((book) => ["books", "book", "articles"].includes(book.category))
    .map((book) => ({
      title: decodeEntities(book.title),
      author: decodeEntities(book.author),
      category: book.category || null,
      coverUrl: book.cover_image_url || null,
      identifiers: {
        goodreads: null,
        isbn: normalizeIsbn(book.isbn || "") || null,
        asin: book.asin || null,
        readwise: String(book.user_book_id || book.id || "") || null,
      },
      highlights: (book.highlights || []).map((highlight) => ({
        id: String(highlight.id),
        text: highlight.text,
      })),
    }));
};

export const bookMatchMethod = (existing, incoming) => {
  const left = existing.identifiers || {};
  const right = incoming.identifiers || {};
  if (left.readwiseBooks && right.readwiseBooks && left.readwiseBooks === right.readwiseBooks) return "readwise-books";
  if (left.readwise && right.readwise && left.readwise === right.readwise) return "readwise";
  if (left.goodreads && right.goodreads && left.goodreads === right.goodreads) return "goodreads";
  if (left.isbn && right.isbn && left.isbn === right.isbn) return "isbn";
  if (left.asin && right.asin && left.asin === right.asin) return "asin";
  if (
    normalizeText(existing.title) === normalizeText(incoming.title) &&
    normalizeText(existing.author) === normalizeText(incoming.author)
  ) return "exact";
  if (
    normalizeTitle(existing.title) === normalizeTitle(incoming.title) &&
    authorsMatch(existing.author, incoming.author)
  ) return "title-author";
  const existingTitle = normalizeTitle(existing.title);
  const incomingTitle = normalizeTitle(incoming.title);
  const shorterTitle = existingTitle.length < incomingTitle.length ? existingTitle : incomingTitle;
  const longerTitle = existingTitle.length < incomingTitle.length ? incomingTitle : existingTitle;
  const titleRemainder = longerTitle.slice(shorterTitle.length).trim();
  if (
    shorterTitle.length >= 8 &&
    longerTitle.startsWith(`${shorterTitle} `) &&
    !/^(?:\d+|[ivxlcdm]+)$/i.test(titleRemainder) &&
    authorsMatch(existing.author, incoming.author)
  ) return "title-prefix-author";
  return null;
};

const matchPriority = {
  "readwise-books": 4,
  readwise: 4,
  goodreads: 4,
  isbn: 4,
  asin: 4,
  exact: 3,
  "title-author": 2,
  "title-prefix-author": 1,
};

const findBookMatch = (books, incoming, { allowPrefix = true, allowSubtitleExpansion = true } = {}) => {
  let best = { index: -1, method: null, priority: 0 };
  books.forEach((book, index) => {
    const method = bookMatchMethod(book, incoming);
    if (!allowPrefix && method === "title-prefix-author") return;
    if (!allowSubtitleExpansion && method === "title-author" && incoming.title.includes(":")) {
      if (normalizeText(withoutSeries(book.title)) !== normalizeText(withoutSeries(incoming.title))) return;
    }
    const priority = matchPriority[method] || 0;
    if (priority > best.priority) best = { index, method, priority };
  });
  return best;
};

const mergeIdentifiers = (existing = {}, incoming = {}) => ({
  ...existing,
  ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value != null && value !== "")),
});

export const mergeBooks = (existingBooks, incomingBooks) => {
  const merged = structuredClone(existingBooks);
  for (const incoming of incomingBooks) {
    const { index } = findBookMatch(merged, incoming, { allowPrefix: false });
    if (index === -1) {
      merged.push(incoming);
      continue;
    }

    const existing = merged[index];
    merged[index] = {
      ...existing,
      ...incoming,
      dateRead: incoming.dateRead || existing.dateRead || null,
      dateAdded: incoming.dateAdded || existing.dateAdded || null,
      coverUrl: incoming.coverUrl || existing.coverUrl || null,
      identifiers: mergeIdentifiers(existing.identifiers, incoming.identifiers),
      highlights: incoming.highlights?.length ? incoming.highlights : existing.highlights || [],
    };
  }
  return merged;
};

export const mergeReadwiseBooks = (existingBooks, incomingBooks, matchOverrides = {}) => {
  const merged = structuredClone(existingBooks);
  const catalogIds = new Set(merged.map(({ id }) => id));
  for (const id of Object.values(matchOverrides)) {
    if (!catalogIds.has(id)) throw new Error(`Readwise Books match is missing from the catalog: ${id}`);
  }
  const linkedIds = new Set(merged.map((book) => book.identifiers?.readwiseBooks).filter(Boolean));
  const completeness = (book) => Number(Boolean(book.dateRead)) + Number(book.rating != null);
  const incoming = [...incomingBooks].sort((a, b) =>
    Number(linkedIds.has(b.identifiers.readwiseBooks)) - Number(linkedIds.has(a.identifiers.readwiseBooks)) ||
    completeness(b) - completeness(a) || a.id.localeCompare(b.id));
  const seen = new Set();
  for (const book of incoming) {
    const overrideId = matchOverrides[book.identifiers.readwiseBooks];
    const index = overrideId
      ? merged.findIndex(({ id }) => id === overrideId)
      : findBookMatch(merged, book, { allowPrefix: false, allowSubtitleExpansion: false }).index;
    if (index === -1) {
      merged.push({ ...book, sourceState: { readwiseBooks: { dateRead: book.dateRead, rating: book.rating } } });
      seen.add(book.id);
      continue;
    }
    const existing = merged[index];
    if (seen.has(existing.id)) continue;
    seen.add(existing.id);
    const previous = existing.sourceState?.readwiseBooks;
    merged[index] = {
      ...existing,
      ...book,
      id: existing.id,
      title: existing.title,
      author: existing.author,
      dateRead: previous && previous.dateRead !== book.dateRead
        ? book.dateRead
        : existing.dateRead || book.dateRead,
      rating: previous && previous.rating !== book.rating
        ? book.rating
        : existing.rating ?? book.rating,
      dateAdded: existing.status === book.status
        ? existing.dateAdded || book.dateAdded
        : book.dateAdded || existing.dateAdded,
      coverUrl: existing.coverUrl || book.coverUrl,
      identifiers: mergeIdentifiers(book.identifiers, existing.identifiers),
      highlights: existing.highlights || [],
      sourceState: { ...existing.sourceState, readwiseBooks: { dateRead: book.dateRead, rating: book.rating } },
    };
  }
  return merged;
};

export const mergeReadwise = (books, readwiseBooks, matchOverrides = {}) => {
  let matched = 0;
  const matchedBookIndexes = new Set();
  const methods = {};
  const matches = [];
  const unmatched = [];
  for (const readwise of readwiseBooks) {
    const readwiseId = readwise.identifiers?.readwise;
    const overrideId = readwiseId ? matchOverrides[readwiseId] : null;
    const overrideIndex = overrideId ? books.findIndex(({ id }) => id === overrideId) : -1;
    const inferredMatch = findBookMatch(books, readwise);
    const { index, method } = overrideIndex === -1
      ? inferredMatch
      : { index: overrideIndex, method: "override" };
    if (index === -1) {
      unmatched.push({
        title: readwise.title,
        author: readwise.author,
        category: readwise.category,
        readwise: readwiseId,
      });
      continue;
    }
    const existing = books[index];
    const isDuplicate = matchedBookIndexes.has(index);
    const highlights = [
      ...(isDuplicate ? existing.highlights || [] : []),
      ...(readwise.highlights || []),
    ]
      .filter((highlight, highlightIndex, all) =>
        all.findIndex(({ id }) => id === highlight.id) === highlightIndex);
    books[index] = {
      ...existing,
      coverUrl: isDuplicate ? existing.coverUrl || readwise.coverUrl : readwise.coverUrl || existing.coverUrl,
      identifiers: {
        ...existing.identifiers,
        isbn: existing.identifiers?.isbn || readwise.identifiers?.isbn || null,
        asin: existing.identifiers?.asin || readwise.identifiers?.asin || null,
        readwise: existing.identifiers?.readwise || readwise.identifiers?.readwise || null,
      },
      highlights,
    };
    matched += 1;
    matchedBookIndexes.add(index);
    methods[method] = (methods[method] || 0) + 1;
    matches.push({
      method,
      goodreads: { title: existing.title, author: existing.author },
      readwise: { title: readwise.title, author: readwise.author },
    });
  }
  return { matched, matchedBooks: matchedBookIndexes.size, methods, matches, unmatched };
};

export const compactBooks = (books) => books.map(({ url: _url, ...book }) => ({
  ...book,
  highlights: (book.highlights || []).map(({ id, text }) => ({ id, text })),
}));

const shortPublicTitle = (title = "") =>
  title.replace(/\s*\([^)]*\)\s*$/, "").split(":", 1)[0].trim();

export const publicBookSlug = ({ title = "" }) =>
  shortPublicTitle(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

export const formativeWorkIdsFor = (books, entries) => {
  const ids = entries.map(({ id }) => id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate formative work IDs: ${[...new Set(duplicateIds)].join(", ")}`);
  }

  const catalogIds = new Set(books.map(({ id }) => id));
  const missingIds = ids.filter((id) => !catalogIds.has(id));
  if (missingIds.length) {
    throw new Error(`Formative works missing from the catalog: ${missingIds.join(", ")}`);
  }

  return new Set(ids);
};

export const publicBookRecord = (book, formativeWorkIds = new Set()) => {
  const {
    id: _id,
    highlights = [],
    identifiers: _identifiers,
    sourceState: _sourceState,
    legacy,
    ...metadata
  } = book;
  const slug = publicBookSlug(book);
  return {
    ...metadata,
    slug,
    ...(legacy?.order != null ? { legacy: { order: legacy.order } } : {}),
    ...(formativeWorkIds.has(book.id) ? { formativeWork: true } : {}),
    highlightCount: highlights.length,
    highlightsPath: highlights.length ? `static/data/highlights/${slug}.json` : null,
  };
};

const writeHighlightData = async (filePath, data) => {
  try {
    const existing = JSON.parse(await readFile(filePath, "utf8"));
    const { updatedAt: _existingUpdatedAt, ...existingContent } = existing;
    const { updatedAt: _nextUpdatedAt, ...nextContent } = data;
    if (JSON.stringify(existingContent) === JSON.stringify(nextContent)) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(filePath, `${JSON.stringify(data)}\n`);
};

const writePublicData = async (books, updatedAt, formativeWorkIds) => {
  await mkdir(highlightsDirectory, { recursive: true });
  const catalogBooks = books.map((book) => publicBookRecord(book, formativeWorkIds));
  const slugs = new Set();
  const highlightFiles = new Map();

  books.forEach((book) => {
    const slug = publicBookSlug(book);
    if (!slug) throw new Error(`Could not create a public slug for ${book.title || "untitled book"}.`);
    if (slugs.has(slug)) throw new Error(`Duplicate public book slug: ${slug}`);
    slugs.add(slug);
    if (!book.highlights?.length) return;
    const filename = `${slug}.json`;
    highlightFiles.set(filename, {
      schemaVersion: 1,
      updatedAt,
      book: slug,
      highlights: book.highlights.map(({ text }) => ({ text })),
    });
  });

  await Promise.all([
    writeFile(
      catalogPath,
      `${JSON.stringify({ schemaVersion: 1, updatedAt, books: catalogBooks })}\n`,
    ),
    ...[...highlightFiles].map(([filename, data]) =>
      writeHighlightData(path.join(highlightsDirectory, filename), data)),
  ]);

  const existingFiles = await readdir(highlightsDirectory);
  await Promise.all(
    existingFiles
      .filter((filename) => filename.endsWith(".json") && !highlightFiles.has(filename))
      .map((filename) => unlink(path.join(highlightsDirectory, filename))),
  );
  console.log(`Built public catalog and ${highlightFiles.size} highlight files.`);
};

const main = async () => {
  const argumentsList = process.argv.slice(2);
  const csvFlag = argumentsList.indexOf("--goodreads-csv");
  const csvPath = csvFlag >= 0 ? argumentsList[csvFlag + 1] : null;
  const current = JSON.parse(await readFile(dataPath, "utf8"));
  const formativeWorks = JSON.parse(await readFile(formativeWorksPath, "utf8"));
  const currentBooks = structuredClone(current.books || []);
  let nextBooks = argumentsList.includes("--replace")
    ? currentBooks.filter(({ legacy }) => legacy?.source === "original-bookshelf")
    : currentBooks;
  let usedSource = argumentsList.includes("--build-public-data");

  if (csvPath) {
    const imported = parseGoodreadsCsv(await readFile(path.resolve(csvPath), "utf8"));
    nextBooks = mergeBooks(nextBooks, imported);
    usedSource = true;
    console.log(`Imported ${imported.length} books from Goodreads CSV.`);
  }

  if (process.env.READWISE_TOKEN) {
    const library = await fetchReadwiseBooks(process.env.READWISE_TOKEN);
    const bookMatches = JSON.parse(await readFile(readwiseBooksMatchesPath, "utf8"));
    const tracked = parseReadwiseBooks(library);
    nextBooks = mergeReadwiseBooks(nextBooks, tracked, bookMatches);
    console.log(`Merged ${tracked.length} tracked books from ${library.length} Readwise Books entries.`);
    const readwise = await fetchReadwise(process.env.READWISE_TOKEN);
    const matchOverrides = JSON.parse(await readFile(readwiseMatchesPath, "utf8"));
    const { matched, matchedBooks, methods, matches, unmatched } = mergeReadwise(nextBooks, readwise, matchOverrides);
    usedSource = true;
    console.log(
      `Matched ${matchedBooks} bookshelf books from ${matched} of ${readwise.length} Readwise Highlights entries: ${JSON.stringify(methods)}.`,
    );
    if (argumentsList.includes("--report-readwise-matches")) {
      console.log(JSON.stringify({
        heuristicMatches: matches.filter(({ method }) => method === "title-author"),
        unmatched,
      }, null, 2));
    }
  }

  if (!usedSource) {
    console.log("No sync source configured; bookshelf data is unchanged.");
    return;
  }

  nextBooks = compactBooks(nextBooks).sort((a, b) => {
    const shelfPriority = { reading: 2, paused: 1 };
    const statusComparison = (shelfPriority[b.status] || 0) - (shelfPriority[a.status] || 0);
    if (statusComparison) return statusComparison;
    const dateComparison = (b.dateRead || b.dateAdded || "").localeCompare(a.dateRead || a.dateAdded || "");
    if (dateComparison) return dateComparison;
    return (a.legacy?.order ?? Number.MAX_SAFE_INTEGER) - (b.legacy?.order ?? Number.MAX_SAFE_INTEGER);
  });
  const formativeWorkIds = formativeWorkIdsFor(nextBooks, formativeWorks.books || []);
  const booksChanged = JSON.stringify(current.books || []) !== JSON.stringify(nextBooks);
  const updatedAt = booksChanged ? new Date().toISOString() : current.updatedAt;
  if (booksChanged) {
    await writeFile(
      dataPath,
      `${JSON.stringify({ schemaVersion: 1, updatedAt, books: nextBooks })}\n`,
    );
    console.log(`Saved ${nextBooks.length} books to ${path.relative(root, dataPath)}.`);
  } else {
    console.log("Bookshelf is already current.");
  }
  await writePublicData(nextBooks, updatedAt, formativeWorkIds);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
