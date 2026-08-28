import {
  bookUrlFor,
  booksForFilter,
  displayDateFor,
  escapeHtml,
  formatDate,
  isRecommended,
  ratingMarkup,
  shortTitleFor,
} from "./book-utils.js?v=20260828-2";

const DATA_URL = "static/data/catalog.json";
const shelf = document.querySelector("#bookshelf");
const filterButton = document.querySelector(".bookshelf-filter");
const selectedFilter = () => new URLSearchParams(window.location.search).get("filter") === "formative" ? "formative" : "all";

const statusMarkup = (book) => ({
  dnf: '<span class="status">didn’t finish</span>',
  paused: '<span class="status">paused</span>',
  reading: '<span class="status">currently reading</span>',
})[book.status] || ratingMarkup(book.rating);

const rowMetaMarkup = (book) => {
  const date = ["paused", "reading"].includes(book.status) ? "" : displayDateFor(book);
  const status = statusMarkup(book);
  const formattedDate = formatDate(date);
  const dateMarkup = formattedDate
    ? `<time class="book-date" datetime="${escapeHtml(date)}">${formattedDate}</time>`
    : "";
  return [status, dateMarkup].filter(Boolean).join('<span class="meta-separator">·</span>');
};

const bookMarkup = (book) => {
  const hasDetails = Number(book.highlightCount) > 0;
  const tag = hasDetails ? "a" : "div";
  const link = hasDetails ? ` href="${bookUrlFor(book)}"` : "";
  return `
  <${tag} class="book${hasDetails ? "" : " is-static"}${isRecommended(book) ? " is-recommended" : ""}${book.formativeWork ? " is-formative-work" : ""}${book.status === "dnf" ? " is-dnf" : ""}${book.status === "paused" ? " is-paused" : ""}"${link}>
    <span class="book-label">
      <span class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(shortTitleFor(book.title))}</span><span class="book-author">${escapeHtml(book.author || "Unknown author")}</span>
    </span>
    <span class="book-row-meta" aria-hidden="true">${rowMetaMarkup(book)}</span>
  </${tag}>`;
};

const render = (books) => {
  if (!books.length) {
    shelf.innerHTML = '<p class="empty-state">Nothing on this shelf yet.</p>';
    return;
  }
  shelf.innerHTML = books.map(bookMarkup).join("");
};

const renderFilter = (books, filter) => {
  const isFormative = filter === "formative";
  filterButton.textContent = isFormative ? "view all works" : "view formative works";
  render(booksForFilter(books, filter));
};

try {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load books (${response.status})`);
  const data = await response.json();
  const books = [...(data.books || [])].sort((a, b) => {
    const shelfPriority = { reading: 2, paused: 1 };
    const statusComparison = (shelfPriority[b.status] || 0) - (shelfPriority[a.status] || 0);
    if (statusComparison) return statusComparison;
    const dateComparison = displayDateFor(b).localeCompare(displayDateFor(a));
    if (dateComparison) return dateComparison;
    return (a.legacy?.order ?? Number.MAX_SAFE_INTEGER) - (b.legacy?.order ?? Number.MAX_SAFE_INTEGER);
  });
  filterButton.addEventListener("click", () => {
    const filter = selectedFilter() === "formative" ? "all" : "formative";
    const url = new URL(window.location.href);
    if (filter === "formative") url.searchParams.set("filter", "formative");
    else url.searchParams.delete("filter");
    window.history.replaceState({}, "", url);
    renderFilter(books, filter);
  });
  shelf.setAttribute("aria-busy", "false");
  renderFilter(books, selectedFilter());
} catch (error) {
  shelf.setAttribute("aria-busy", "false");
  shelf.innerHTML = `<p class="empty-state">The shelf couldn’t be opened.<br>${escapeHtml(error.message)}</p>`;
}
