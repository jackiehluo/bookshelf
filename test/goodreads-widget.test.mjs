import assert from "node:assert/strict";
import test from "node:test";
import { fetchGoodreadsShelves, parseGoodreadsWidget } from "../scripts/goodreads-widget.mjs";

const widget = (shelf = "read", body = "") => {
  const html = `<div class="gr_custom_container_test"><a href="/review/list/42?shelf=${shelf}&amp;utm_source=custom_widget">Books</a>${body}</div>`;
  return `var widget_code = '${html.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll('"', '\\"')}'\nvar widget_div = document.getElementById('test')`;
};
const row = `<div class="gr_custom_each_container_test">
  <div class="gr_custom_book_container_test"><a title="Writer&#39;s Book: A &amp; B" href="/review/show/123"><img alt="Writer's Book" /></a></div>
  <div class="gr_custom_rating_test"><span>${Array.from({ length: 5 }, (_, i) => `<img src="gr_flat_red_star_${i < 4 ? "active" : "inactive"}.png" />`).join("")}</span></div>
  <div class="gr_custom_title_test"><a href="/review/show/123">Writer's Book</a></div>
  <div class="gr_custom_author_test">by <a>Slavoj Žižek</a></div>
</div>`;

test("parses widget data without running its JavaScript", () => {
  const script = `${widget("read", row)}\nthrow new Error('must not run');`;
  assert.deepEqual(parseGoodreadsWidget(script, "read", "42"), [{
    reviewId: "123", title: "Writer's Book: A & B", author: "Slavoj Žižek", status: "finished", rating: 4,
  }]);
});

test("accepts empty shelves but rejects login pages, wrong shelves, and incomplete rows", () => {
  assert.deepEqual(parseGoodreadsWidget(widget(), "read", "42"), []);
  assert.throws(() => parseGoodreadsWidget("<html>Sign in</html>", "read", "42"), /widget/);
  assert.throws(() => parseGoodreadsWidget(widget("to-read"), "read", "42"), /wrong shelf/);
  assert.throws(() => parseGoodreadsWidget(widget(), "read", "43"), /wrong shelf/);
  assert.throws(() => parseGoodreadsWidget(widget("read", row.replace("gr_flat_red_star_active.png", "changed.png")), "read", "42"), /Incomplete/);
});

test("fetches four independent public widgets ordered by latest change", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    const shelf = url.searchParams.get("shelf");
    return new Response(widget(shelf, shelf === "read" ? row : ""));
  });
  assert.equal((await fetchGoodreadsShelves("42")).length, 1);
  assert.equal(new Set(requests.map(({ url }) => url.searchParams.get("widget_id"))).size, 4);
  assert.ok(requests.every(({ url, options }) => url.searchParams.get("sort") === "date_updated"
    && options.redirect === "error" && !options.headers));
  await assert.rejects(fetchGoodreadsShelves("not-an-id"), /numeric/);
});

test("rejects conflicting cached shelves before touching Readwise", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new Response(widget(url.searchParams.get("shelf"), row)));
  await assert.rejects(fetchGoodreadsShelves("42"), /conflicting shelves/);
});
