import {
  escapeHtml,
  formatDate,
  ratingMarkup,
} from "./book-utils.js";

const CATALOG_URL = "static/data/catalog.json";
const page = document.querySelector("#book-page");

const highlightMarkup = (highlight) =>
  `<li class="highlight"><blockquote>${escapeHtml(highlight.text)}</blockquote></li>`;

const bookMetaMarkup = (book, highlightCount) => {
  const status = book.status === "dnf"
    ? '<span class="status">didn’t finish</span>'
    : ratingMarkup(book.rating);
  const readDate = book.dateRead
    ? `<time class="book-page-date" datetime="${escapeHtml(book.dateRead)}">${formatDate(book.dateRead)}</time>`
    : "";
  const highlightLabel = highlightCount === 1 ? "1 highlight" : `${highlightCount} highlights`;
  return [
    status,
    readDate,
    `<span class="highlight-count">${highlightLabel}</span>`,
  ].filter(Boolean).join("");
};

const render = (book, highlights) => {
  const cover = book.coverUrl
    ? `<img class="book-cover" src="${escapeHtml(book.coverUrl)}" alt="Cover of ${escapeHtml(book.title)}" />`
    : "";
  const highlightsContent = highlights.length
    ? `<ol class="highlight-list">${highlights.map(highlightMarkup).join("")}</ol>`
    : '<p class="no-highlights">No highlights for this book.</p>';

  page.innerHTML = `
    <article class="book-profile${book.status === "dnf" ? " is-dnf" : ""}">
      <header class="book-profile-header">
        <div class="book-profile-copy">
          <h1 class="book-page-title">${escapeHtml(book.title)}</h1>
          <p class="book-page-author">${escapeHtml(book.author || "Unknown author")}</p>
          <div class="book-page-meta">${bookMetaMarkup(book, highlights.length)}</div>
        </div>
        ${cover}
      </header>
      <section class="book-highlights" aria-label="Highlights">
        ${highlightsContent}
      </section>
    </article>`;
};

try {
  const bookId = new URLSearchParams(window.location.search).get("id");
  if (!bookId) throw new Error("No book was selected.");

  const catalogResponse = await fetch(CATALOG_URL);
  if (!catalogResponse.ok) throw new Error(`Could not load the bookshelf (${catalogResponse.status})`);
  const catalog = await catalogResponse.json();
  const book = (catalog.books || []).find(({ id }) => id === bookId);
  if (!book) throw new Error("This book isn’t on the shelf.");

  let highlights = [];
  if (book.highlightsPath) {
    const highlightsResponse = await fetch(book.highlightsPath);
    if (!highlightsResponse.ok) throw new Error(`Could not load highlights (${highlightsResponse.status})`);
    highlights = (await highlightsResponse.json()).highlights || [];
  }

  document.title = `${book.title} — Jackie Luo`;
  page.setAttribute("aria-busy", "false");
  render(book, highlights);
} catch (error) {
  page.setAttribute("aria-busy", "false");
  page.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}<br><a href="index.html">Back to the bookshelf</a></p>`;
}
