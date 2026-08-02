import assert from "node:assert/strict";
import test from "node:test";

import { isRecommended } from "../static/js/book-utils.js";

test("recommends only highly rated books with enough highlights", () => {
  assert.equal(isRecommended({ rating: 5, highlightCount: 4 }), false);
  assert.equal(isRecommended({ rating: 4, highlightCount: 5 }), true);
  assert.equal(isRecommended({ rating: 3, highlightCount: 20 }), false);
});
