import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const services = `
const library = [
  { id: 7, title: "On Belief", author: "Slavoj Žižek", status: "want_to_read", rating: null },
  { id: 8, title: "Fanged Noumena", author: "Nick Land", status: "want_to_read", rating: null },
];
const source = [
  { id: "99", title: "On Belief", author: "Slavoj Žižek" },
  { id: "100", title: "Fanged Noumena: Collected Writings 1987-2007", author: "Nick Land" },
];
const rows = source.map(b => '<div class="gr_custom_each_container_test">'
  + '<div class="gr_custom_book_container_test"><a title="' + b.title + '"></a></div>'
  + '<div class="gr_custom_title_test"><a href="/review/show/' + b.id + '">' + b.title + '</a></div>'
  + '<div class="gr_custom_author_test">by <a>' + b.author + '</a></div>'
  + '<div class="gr_custom_rating_test">' + '<img src="gr_flat_red_star_inactive.png">'.repeat(5) + '</div></div>').join('');
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.hostname === "www.goodreads.com") {
    const shelf = url.searchParams.get("shelf");
    const html = '<div class="gr_custom_container_test"><a href="/review/list/42?shelf=' + shelf
      + '&amp;utm_source=custom_widget">Books</a>' + (shelf === "currently-reading" ? rows : '') + '</div>';
    return new Response("var widget_code = '" + html + "'\\n");
  }
  if (options.method === "PATCH") {
    if (process.env.SYNC_TEST_FAILURE === "write") return new Response(null, { status: 503 });
    const { items } = JSON.parse(options.body);
    if (items.some(item => item.id !== 7)) throw new Error("An ambiguous book was changed");
    if (process.env.SYNC_TEST_FAILURE !== "verification") Object.assign(library[0], items[0]);
    return Response.json({ results: items.map(({ id }) => ({ id, status: "updated", error: null })) });
  }
  if (options.method) throw new Error("Unexpected mutation: " + options.method);
  return Response.json({ results: library, next: null });
};
`;

const runSync = async (t, { failure = "", previous = [], bindings = {} } = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "bookshelf-sync-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "scripts"));
  await mkdir(path.join(directory, "_data"));
  for (const name of ["sync-goodreads-readwise.mjs", "goodreads-widget.mjs", "sync-books.mjs", "readwise-books.mjs"]) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), path.join(directory, "scripts", name));
  }
  for (const [name, data] of Object.entries({ "books.json": { books: [] },
    "goodreads-readwise-matches.json": bindings, "goodreads-sync-issues.json": previous })) {
    await writeFile(path.join(directory, "_data", name), JSON.stringify(data));
  }
  await writeFile(path.join(directory, "services.mjs"), services);
  const result = await execute(process.execPath, ["--import", "./services.mjs", "scripts/sync-goodreads-readwise.mjs", "--apply"], {
    cwd: directory, env: { ...process.env, READWISE_TOKEN: "test-token", GOODREADS_USER_ID: "42",
      GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: path.join(directory, "summary.md"), SYNC_TEST_FAILURE: failure },
  }).catch((error) => error);
  const issues = JSON.parse(await readFile(path.join(directory, "_data/goodreads-sync-issues.json"), "utf8"));
  const matches = JSON.parse(await readFile(path.join(directory, "_data/goodreads-readwise-matches.json"), "utf8"));
  return { result, issues, matches, directory };
};

test("the real CLI syncs a confirmed book and reports an unresolved book without failing", async (t) => {
  const old = { reviewId: "500", title: "Outside the widget window", reason: "ambiguous editions", candidates: [] };
  const { result, issues, matches, directory } = await runSync(t, { previous: [old] });
  assert.equal(result.code, undefined, result.stderr);
  assert.match(result.stdout, /Verified 1 updates and 0 additions; 2 books need matching/);
  assert.match(result.stderr, /::warning title=Books need matching::/);
  assert.deepEqual(issues.map(({ reviewId }) => reviewId), ["100", "500"]);
  assert.equal(issues[0].candidates[0].id, 8);
  assert.deepEqual(matches, { 99: 7 });
  const summary = await readFile(path.join(directory, "summary.md"), "utf8");
  assert.match(summary, /goodreads.com\/review\/show\/100/);
  assert.match(summary, /8: Fanged Noumena by Nick Land/);
});

test("the issue report clears an observed book once its ID binding is resolved", async (t) => {
  const previous = [{ reviewId: "99", title: "On Belief", candidates: [] }];
  const { result, issues } = await runSync(t, { previous, bindings: { 99: 7 } });
  assert.equal(result.code, undefined, result.stderr);
  assert.deepEqual(issues.map(({ reviewId }) => reviewId), ["100"]);
});

for (const failure of ["write", "verification"]) {
  test(`the CLI still fails on a real ${failure} failure`, async (t) => {
    const { result, issues } = await runSync(t, { failure });
    assert.notEqual(result.code, undefined);
    assert.match(result.stderr, failure === "write" ? /503/ : /did not converge/);
    assert.deepEqual(issues, []);
  });
}
