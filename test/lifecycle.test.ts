import { test } from "node:test";
import assert from "node:assert/strict";
import { LifecycleTracker } from "../src/core/lifecycle.js";
import type { BundleStatus } from "../src/shared/ports.js";
import type { Lifecycle } from "../src/shared/types.js";

function submitted(sig: string, extra: Partial<Lifecycle> = {}): Lifecycle {
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
    lastValidBlockHeight: null,
    landedSlot: null,
    blockhashSource: null,
    landedPerBundleStatus: null,
    targetLeaderSkipped: false,
    ...extra,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

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
  assert.equal(l.landedSlot, 100);
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

// --- Phase 2: precise expiry ---

test("expired_blockhash only when chain height passes lastValidBlockHeight", () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.track(submitted("sigE", { lastValidBlockHeight: 1000 }), 60_000);
  t.onBlock(999);
  t.onBlock(1000); // exactly at the limit: still valid
  assert.equal(settled.length, 0);
  t.onBlock(1001); // past the limit: true expiry
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, "expired_blockhash");
});

test("TTL with still-valid blockhash is NOT expired_blockhash", async () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.track(submitted("sigF", { lastValidBlockHeight: 1_000_000 }), 0);
  t.onBlock(500_000); // far below lvbh: hash is alive
  await tick();
  t.onSlot(200, "processed"); // triggers the sweep
  assert.equal(settled.length, 1);
  assert.notEqual(settled[0]!.failure, "expired_blockhash");
  assert.equal(settled[0]!.failure, "bundle_dropped");
});

test("TTL with unknown blockhash validity never settles expired_blockhash", async () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.track(submitted("sigG"), 0); // no lvbh, no block feed
  await tick();
  t.onSlot(200, "processed");
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, "bundle_dropped");
});

test("bundleStatus landed=false after TTL settles bundle_dropped", async () => {
  const settled: Lifecycle[] = [];
  const statuses: string[] = [];
  const status = async (id: string): Promise<BundleStatus> => {
    statuses.push(id);
    return { landed: false, slot: null, err: null };
  };
  const t = new LifecycleTracker((l) => settled.push(l), undefined, status);
  t.track(submitted("sigH", { bundleId: "b1", lastValidBlockHeight: 1_000_000 }), 0, {
    start: 105,
    end: 108,
  });
  t.onBlock(500_000);
  await tick();
  t.onSlot(104, "confirmed");
  t.onSlot(106, "confirmed"); // a window slot was confirmed: leader did not skip
  t.onSlot(110, "confirmed"); // window passed -> sweep fires the one-shot check
  await tick();
  assert.deepEqual(statuses, ["b1"]);
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, "bundle_dropped");
  assert.equal(settled[0]!.landedPerBundleStatus, false);
  assert.equal(settled[0]!.targetLeaderSkipped, false);
});

test("bundleStatus landed=true extends the TTL instead of settling", async () => {
  const settled: Lifecycle[] = [];
  const status = async (): Promise<BundleStatus> => ({ landed: true, slot: 106, err: null });
  const t = new LifecycleTracker((l) => settled.push(l), undefined, status);
  t.track(submitted("sigI", { bundleId: "b2", lastValidBlockHeight: 1_000_000 }), 0);
  await tick();
  t.onSlot(110, "confirmed");
  await tick();
  assert.equal(settled.length, 0); // still waiting for the stream to confirm
  t.onTx("sigI", 106, null);
  t.onSlot(106, "finalized");
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, null);
  assert.equal(settled[0]!.landedPerBundleStatus, true);
});

test("skipped leader window settles leader_skipped", async () => {
  const settled: Lifecycle[] = [];
  const t = new LifecycleTracker((l) => settled.push(l));
  t.track(submitted("sigJ", { lastValidBlockHeight: 1_000_000 }), 0, { start: 105, end: 108 });
  t.onBlock(500_000);
  await tick();
  t.onSlot(104, "confirmed");
  t.onSlot(110, "confirmed"); // chain jumped the window; none of 105-108 confirmed
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.failure, "leader_skipped");
  assert.equal(settled[0]!.targetLeaderSkipped, true);
});
