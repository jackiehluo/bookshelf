export const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );

export const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export const displayDateFor = (book) => book.dateRead || book.dateAdded || "";

export const shortTitleFor = (title) =>
  title.replace(/\s*\([^)]*\)\s*$/, "").split(":", 1)[0].trim();

export const ratingMarkup = (rating) => {
  if (!rating) return "";
  const rounded = Math.max(0, Math.min(5, Math.round(Number(rating))));
  return `<span class="rating" aria-label="${rounded} out of 5 stars">${"●".repeat(rounded)}${"○".repeat(5 - rounded)}</span>`;
};

export const bookUrlFor = (book) => {
  const page = window.location.protocol === "file:" ? "book/index.html" : "book/";
  return `${page}?title=${encodeURIComponent(book.slug)}`;
};
