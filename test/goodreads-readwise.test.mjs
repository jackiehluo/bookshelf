import assert from "node:assert/strict";
import test from "node:test";
import { applyGoodreadsSync, planGoodreadsSync } from "../scripts/sync-goodreads-readwise.mjs";

const source = { reviewId: "99", title: "On Belief (Thinking in Action)", author: "Slavoj Žižek", status: "currently_reading", rating: null };
const book = { id: 7, title: "On Belief", author: "Žižek, Slavoj", status: "want_to_read", rating: null, finished_reading_at: "2020-01-02T00:00:00Z" };

test("syncs On Belief status, preserves dates, and converges on a second run", () => {
  const plan = planGoodreadsSync([source], [book], []);
  assert.deepEqual(plan.updates, [{ title: source.title, item: { id: 7, status: "currently_reading" } }]);
  assert.equal(plan.matches[99], 7);
  const next = planGoodreadsSync([source], [{ ...book, status: "currently_reading" }], [], plan.matches);
  assert.equal(next.updates.length + next.creates.length, 0);
  assert.equal(book.finished_reading_at, "2020-01-02T00:00:00Z");
});

test("uses saved edition bindings, clears ratings, and leaves absent books alone", () => {
  const plan = planGoodreadsSync([source], [{ ...book, rating: 4 }, { ...book, id: 8 }], [], { 99: 7 });
  assert.deepEqual(plan.updates[0].item, { id: 7, status: "currently_reading", rating: null });
  assert.equal(plan.updates.length, 1);
  assert.throws(() => planGoodreadsSync([source], [], [], { 99: 7 }), /Missing linked/);
});

test("uses archive bindings for renamed editions and skips ambiguous matches", () => {
  const renamed = { ...book, title: "Belief", author: "Another name" };
  const archive = [{ title: source.title, author: source.author, identifiers: { readwiseBooks: "7" } }];
  assert.equal(planGoodreadsSync([source], [renamed], archive).updates[0].item.id, 7);
  assert.equal(planGoodreadsSync([source], [book, { ...book, id: 8 }], []).skipped.length, 1);
});

test("never confuses a new sequel with a matching title prefix", () => {
  const sequel = { ...source, title: "Binti: Home", author: "Nnedi Okorafor" };
  const original = { ...book, title: "Binti", author: "Nnedi Okorafor" };
  const plan = planGoodreadsSync([sequel], [original], []);
  assert.equal(plan.updates.length + plan.creates.length, 0);
  assert.equal(plan.skipped.length, 1);
});

test("keeps distinct non-Latin books separate", () => {
  const next = { ...source, title: "临高启明", author: "吹牛者" };
  const existing = { ...book, title: "三体", author: "刘慈欣" };
  const plan = planGoodreadsSync([next], [existing, { ...book, title: null }], []);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.creates.length, 1);
});

test("persists create bindings and checks per-item failures even on HTTP 200", async (t) => {
  const plan = planGoodreadsSync([source], [], []);
  const saved = [];
  t.mock.method(globalThis, "fetch", async () => Response.json({ results: [{ status: "created", book_id: 7, error: null }] }));
  await applyGoodreadsSync(plan, "token", async (matches) => saved.push({ ...matches }));
  assert.equal(saved.at(-1)[99], 7);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ results: [{ status: "error", error: { code: "invalid_value" } }] }));
  await assert.rejects(applyGoodreadsSync(plan, "token", async () => {}), /invalid_value/);
});
