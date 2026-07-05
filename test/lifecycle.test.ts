import { test } from "node:test";
import assert from "node:assert/strict";
import { LifecycleTracker } from "../src/core/lifecycle.js";
import type { Lifecycle } from "../src/shared/types.js";

function submitted(sig: string): Lifecycle {
  return {
    signature: sig,
    source: "submitted",
    bundleId: null,
    tip: 5000,
    payload: "x",
    stages: {},
    failure: null,
    retryOf: null,
    trace: null,
  };
}

test("observed tx advances processed -> confirmed -> finalized", () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.onTx("sigA", 100, null);
  t.onSlot(100, "confirmed");
  t.onSlot(100, "finalized");
  assert.equal(settled.length, 1);
  const l = settled[0]!;
  assert.equal(l.source, "observed");
  assert.ok(l.stages.processed && l.stages.confirmed && l.stages.finalized);
  assert.equal(l.failure, null);
});

test("submitted bundle expires when not processed within ttl", async () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.track(submitted("sigB"), 0);
  await new Promise((r) => setTimeout(r, 5));
  t.onSlot(200, "processed");
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, "expired_blockhash");
});

test("submitted bundle lands and seals successfully", () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.track(submitted("sigC"), 60_000);
  t.onTx("sigC", 300, null);
  t.onSlot(300, "finalized");
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, null);
  assert.ok(settled[0]!.stages.submitted && settled[0]!.stages.finalized);
});

// Phase 0 regression: our own submissions are observed via the tip-account watch
// set; once onTx arrives (whatever account matched), the entry must settle clean.
test("tracked submitted signature with onTx + finalized settles with failure: null", () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.track(submitted("sigTip"), 60_000);
  t.onTx("sigTip", 500, null);
  t.onSlot(500, "confirmed");
  t.onSlot(500, "finalized");
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, null);
  assert.equal(settled[0]!.source, "submitted");
});

test("failed observed tx settles with a classified failure", () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.onTx("sigD", 400, { InstructionError: [0, "ComputeBudgetExceeded"] });
  assert.equal(settled[0]!.failure, "compute_exceeded");
});
