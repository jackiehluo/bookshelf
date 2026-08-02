import {
  escapeHtml,
  formatDate,
  ratingMarkup,
} from "./book-utils.js";

const CATALOG_URL = "static/data/catalog.json";
const page = document.querySelector("#book-page");

const highlightMarkup = (highlight) =>
  `<li class="highlight"><blockquote>${escapeHtml(highlight.text)}</blockquote></li>`;

const titleMarkup = (title) => {
  let primary = title.trim();
  const secondary = [];
  let series = primary.match(/\s+(\([^()]+\))$/);
  while (series) {
    primary = primary.slice(0, series.index).trim();
    secondary.unshift(series[1]);
    series = primary.match(/\s+(\([^()]+\))$/);
  }

  const separator = primary.indexOf(":");
  if (separator !== -1) {
    const subtitle = primary.slice(separator + 1).trim();
    primary = primary.slice(0, separator).trim();
    if (subtitle) secondary.unshift(subtitle);
  }

  if (!primary || !secondary.length) return escapeHtml(title);
  return `<span class="book-page-title-primary">${escapeHtml(primary)}</span>${secondary.map((part) => `<span class="book-page-subtitle">${escapeHtml(part)}</span>`).join("")}`;
};

const statusMarkup = (book) => ({
  dnf: '<span class="status">didn’t finish</span>',
  paused: '<span class="status">paused</span>',
  reading: '<span class="status">currently reading</span>',
})[book.status] || ratingMarkup(book.rating);

const bookMetaMarkup = (book, highlightCount) => {
  const status = statusMarkup(book);
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
    ? `<div class="book-cover-frame"><img class="book-cover" src="${escapeHtml(book.coverUrl)}" alt="Cover of ${escapeHtml(book.title)}" /></div>`
    : "";
  const highlightsContent = highlights.length
    ? `<ol class="highlight-list">${highlights.map(highlightMarkup).join("")}</ol>`
    : '<p class="no-highlights">No highlights for this book.</p>';

  page.innerHTML = `
    <article class="book-profile${book.status === "dnf" ? " is-dnf" : ""}">
      <header class="book-profile-header">
        <div class="book-profile-copy">
          <h1 class="book-page-title" aria-label="${escapeHtml(book.title)}">${titleMarkup(book.title)}</h1>
          <p class="book-page-author">${escapeHtml(book.author || "Unknown author")}</p>
          <div class="book-page-meta">${bookMetaMarkup(book, highlights.length)}</div>
        </div>
        ${cover}
      </header>
      <section class="book-highlights" aria-label="Highlights">
        ${highlightsContent}
      </section>
    </article>`;

  const coverImage = page.querySelector(".book-cover");
  if (coverImage) {
    const revealCover = () => coverImage.classList.add("is-loaded");
    if (coverImage.complete && coverImage.naturalWidth > 0) revealCover();
    else coverImage.addEventListener("load", revealCover, { once: true });
  }
};

try {
  const bookId = new URLSearchParams(window.location.search).get("id");
  if (!bookId) throw new Error("No book was selected.");

  const catalogResponse = await fetch(CATALOG_URL, { cache: "no-store" });
  if (!catalogResponse.ok) throw new Error(`Could not load the bookshelf (${catalogResponse.status})`);
  const catalog = await catalogResponse.json();
  const book = (catalog.books || []).find(({ id }) => id === bookId);
  if (!book) throw new Error("This book isn’t on the shelf.");

  let highlights = [];
  if (book.highlightsPath) {
    const highlightsResponse = await fetch(book.highlightsPath, { cache: "no-store" });
    if (!highlightsResponse.ok) throw new Error(`Could not load highlights (${highlightsResponse.status})`);
    highlights = (await highlightsResponse.json()).highlights || [];
  }

  document.title = `${book.title} | Jackie Luo`;
  page.setAttribute("aria-busy", "false");
  render(book, highlights);
} catch (error) {
  page.setAttribute("aria-busy", "false");
  page.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}<br><a href="index.html">Back to the bookshelf</a></p>`;
}
