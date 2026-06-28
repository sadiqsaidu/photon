import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/core/classifier.js";

test("classifies blockhash expiry", () => {
  assert.equal(classify({ InstructionError: [0, "BlockhashNotFound"] }, {}), "expired_blockhash");
  assert.equal(classify("BlockhashExpired", {}), "expired_blockhash");
});

test("classifies compute exceeded", () => {
  assert.equal(classify({ InstructionError: [1, "ComputeBudgetExceeded"] }, {}), "compute_exceeded");
});

test("hints take precedence", () => {
  assert.equal(classify(null, { leaderSkipped: true }), "leader_skipped");
  assert.equal(classify(null, { timedOut: true }), "bundle_dropped");
});

test("unknown by default", () => {
  assert.equal(classify({ weird: 1 }, {}), "unknown");
});
