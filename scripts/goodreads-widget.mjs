import { decodeEntities } from "./sync-books.mjs";

export const goodreadsShelves = {
  "currently-reading": "currently_reading",
  read: "finished",
  "did-not-finish": "did_not_finish",
  "to-read": "want_to_read",
};

const text = (html) => decodeEntities(html.replace(/<[^>]*>/g, ""));
const field = (html, name) => html.match(new RegExp(`<div class="gr_custom_${name}_[^"]+">([\\s\\S]*?)<\\/div>`))?.[1];

export const parseGoodreadsWidget = (script, shelf, userId) => {
  if (!Object.hasOwn(goodreadsShelves, shelf)) throw new Error(`Unsupported Goodreads shelf: ${shelf}`);
  const literal = script.match(/var widget_code = '((?:\\[\s\S]|[^'\\])*)'\s*\n/);
  if (!literal) throw new Error("Goodreads did not return a shelf widget.");
  const html = literal[1].replace(/\\(u[0-9a-f]{4}|[\\'"/nrtbf])/gi, (_, escape) => {
    if (escape.startsWith("u")) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[escape] ?? escape;
  });
  if (!html.includes(`class="gr_custom_container_`) || html.match(/\/review\/list\/(\d+)(?:-|\?)/)?.[1] !== userId
    || !html.includes(`?shelf=${shelf}&amp;`)) {
    throw new Error(`Goodreads returned the wrong shelf widget: ${shelf}`);
  }
  const rows = html.split(/<div class="gr_custom_each_container_[^"]+">/).slice(1);
  return rows.map((row) => {
    const titleHtml = field(row, "title");
    const authorHtml = field(row, "author");
    const ratingHtml = field(row, "rating");
    const reviewId = titleHtml?.match(/\/review\/show\/(\d+)/)?.[1];
    const fullTitle = field(row, "book_container")?.match(/<a title="([^"]+)"/)?.[1];
    const author = authorHtml && text(authorHtml).replace(/^by\s+/, "");
    const stars = ratingHtml?.match(/gr_flat_red_star_(?:in)?active\.png/g) || [];
    if (!reviewId || !fullTitle || !author || stars.length !== 5) {
      throw new Error(`Incomplete Goodreads widget row on ${shelf}.`);
    }
    return {
      reviewId, title: decodeEntities(fullTitle), author,
      status: goodreadsShelves[shelf],
      rating: stars.filter((star) => star === "gr_flat_red_star_active.png").length || null,
    };
  });
};

export const fetchGoodreadsShelves = async (userId) => {
  if (!/^\d+$/.test(userId)) throw new Error("GOODREADS_USER_ID must be a numeric profile ID.");
  const books = [];
  for (const shelf of Object.keys(goodreadsShelves)) {
    const url = new URL(`https://www.goodreads.com/review/custom_widget/${userId}`);
    url.search = new URLSearchParams({
      shelf, num_books: "100", sort: "date_updated", order: "d",
      show_author: "1", show_cover: "1", show_rating: "1", show_review: "0", show_tags: "0", show_title: "1",
      widget_id: `bookshelf_v1_${shelf.replaceAll("-", "_")}`,
    });
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Goodreads ${shelf} widget returned ${response.status}.`);
    const entries = parseGoodreadsWidget(await response.text(), shelf, userId);
    console.log(`Read ${entries.length} Goodreads ${shelf} entries${entries.length === 100 ? " (widget limit)" : ""}.`);
    books.push(...entries);
  }
  if (!books.length) throw new Error("Goodreads returned no books; refusing to sync an empty library.");
  if (new Set(books.map(({ reviewId }) => reviewId)).size !== books.length) {
    throw new Error("Goodreads returned conflicting shelves for the same review; retry after its widget cache refreshes.");
  }
  return books;
};
