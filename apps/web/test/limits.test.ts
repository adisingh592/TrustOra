import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DELIVERABLE_CHARS as BROWSER_LIMIT } from "../src/lib/limits";
import { MAX_DELIVERABLE_CHARS as EVALUATOR_LIMIT } from "../../../packages/evaluation/src/index";

test("the browser-side deliverable limit equals the evaluator's real limit", () => {
  assert.equal(BROWSER_LIMIT, EVALUATOR_LIMIT);
});
