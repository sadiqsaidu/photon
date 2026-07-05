import { test } from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { Submitter, type SubmitContext } from "../src/core/submission.js";
import { BundleBuilder, SelfTransferMemo } from "../src/core/builder.js";
import { ephemeralSigner } from "../src/adapters/signer.js";
import { TipOracle } from "../src/core/tip-oracle.js";
import type { BundleGateway, DecisionPort, RpcGateway } from "../src/shared/ports.js";
import type { Lifecycle } from "../src/shared/types.js";
import type { Store } from "../src/db/store.js";

const TIP_ACCOUNT = "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5";

const rpc: RpcGateway = {
  async latestBlockhash() {
    return { blockhash: bs58.encode(new Uint8Array(32).fill(1)), lastValidBlockHeight: 1000 };
  },
  async blockHeight() {
    return 1000;
  },
};

function jitoMock(sent: string[][]): BundleGateway {
  return {
    async tipAccounts() { return [TIP_ACCOUNT]; },
    async nextLeader() { return { currentSlot: 1, nextLeaderSlot: 2 }; },
    async sendBundle(txs) { sent.push(txs); return `bundle-${sent.length}`; },
    async bundleStatus() { return { landed: false, slot: null, err: null }; },
  };
}

const storeMock = { async saveLifecycle() {}, async saveDecision() {} } as unknown as Store;

function ctxMock(tracked: Lifecycle[], settled: Lifecycle[] = []): SubmitContext {
  return {
    track(l) { tracked.push(l); },
    settleNow(l) { settled.push(l); },
    tip() { return { tip: 5000, trace: null }; },
    slotsToLeader() { return 2; },
  };
}

const noTipPolicy: DecisionPort["tipPolicy"] = async () => {
  throw new Error("not used");
};

test("submit builds, sends, and tracks a submitted lifecycle", async () => {
  const sent: string[][] = [];
  const tracked: Lifecycle[] = [];
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT]);
  const agent: DecisionPort = { tipPolicy: noTipPolicy, async recover() { throw new Error("not used"); } };
  const sub = new Submitter(builder, jitoMock(sent), ephemeralSigner(), agent, new TipOracle(), storeMock, ctxMock(tracked));

  const sig = await sub.submit(new SelfTransferMemo());
  assert.equal(sent.length, 1);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0]!.source, "submitted");
  assert.equal(tracked[0]!.tip, 5000);
  assert.equal(typeof sig, "string");
});

test("onFailure consults the agent and resubmits", async () => {
  const sent: string[][] = [];
  const tracked: Lifecycle[] = [];
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT]);
  let recoverCalls = 0;
  const agent: DecisionPort = {
    tipPolicy: noTipPolicy,
    async recover() {
      recoverCalls++;
      return { action: "resubmit", refreshBlockhash: true, tip: 7000, trace: { reasoning: "refresh", confidence: 0.6 } };
    },
  };
  const sub = new Submitter(builder, jitoMock(sent), ephemeralSigner(), agent, new TipOracle(), storeMock, ctxMock(tracked));

  const sig = await sub.submit(new SelfTransferMemo());
  const l = tracked[0]!;
  l.failure = "expired_blockhash";
  await sub.onFailure(l);

  assert.equal(recoverCalls, 1);
  assert.equal(sent.length, 2);
  assert.equal(tracked[1]!.retryOf, sig);
  assert.equal(tracked[1]!.tip, 7000);
});

test("submitSigned sends and tracks an externally-signed bundle without auto-retry", async () => {
  const sent: string[][] = [];
  const tracked: Lifecycle[] = [];
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT]);
  const agent: DecisionPort = { tipPolicy: noTipPolicy, async recover() { throw new Error("not used"); } };
  const sub = new Submitter(builder, jitoMock(sent), undefined, agent, new TipOracle(), storeMock, ctxMock(tracked));

  const bundleId = await sub.submitSigned({ signedTxs: ["QkFTRTY0"], signature: "sigExt", tip: 4000 });
  assert.equal(sent.length, 1);
  assert.equal(bundleId, "bundle-1");
  assert.equal(tracked[0]!.signature, "sigExt");
  assert.equal(tracked[0]!.source, "submitted");

  const l = tracked[0]!;
  l.failure = "bundle_dropped";
  await sub.onFailure(l);
  assert.equal(sent.length, 1);
});

test("send rejection by all engines settles send_rejected immediately, no tracking", async () => {
  const tracked: Lifecycle[] = [];
  const settled: Lifecycle[] = [];
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT]);
  const jito: BundleGateway = {
    async tipAccounts() { return [TIP_ACCOUNT]; },
    async nextLeader() { return { currentSlot: 1, nextLeaderSlot: 2 }; },
    async sendBundle() { throw new AggregateError([new Error("engine A: 429"), new Error("engine B: down")], "all rejected"); },
    async bundleStatus() { return { landed: false, slot: null, err: null }; },
  };
  const agent: DecisionPort = { tipPolicy: noTipPolicy, async recover() { throw new Error("not used"); } };
  const sub = new Submitter(builder, jito, ephemeralSigner(), agent, new TipOracle(), storeMock, ctxMock(tracked, settled));

  const sig = await sub.submit(new SelfTransferMemo());
  assert.equal(tracked.length, 0); // never became a 60s zombie
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.signature, sig);
  assert.equal(settled[0]!.failure, "send_rejected");
  assert.equal(settled[0]!.bundleId, null);
  assert.ok(settled[0]!.stages.submitted);
});

test("send_rejected routes through recovery and retries via the agent", async () => {
  const tracked: Lifecycle[] = [];
  const settled: Lifecycle[] = [];
  const sent: string[][] = [];
  let fail = true;
  const jito: BundleGateway = {
    async tipAccounts() { return [TIP_ACCOUNT]; },
    async nextLeader() { return { currentSlot: 1, nextLeaderSlot: 2 }; },
    async sendBundle(txs) {
      if (fail) throw new AggregateError([new Error("engine A: down")], "all rejected");
      sent.push(txs);
      return "bundle-ok";
    },
    async bundleStatus() { return { landed: false, slot: null, err: null }; },
  };
  const agent: DecisionPort = {
    tipPolicy: noTipPolicy,
    async recover(ctx) {
      assert.equal(ctx.failure, "send_rejected");
      return { action: "resubmit", refreshBlockhash: true, tip: 6000, trace: { reasoning: "retry send", confidence: 0.6 } };
    },
  };
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT]);
  const sub = new Submitter(builder, jito, ephemeralSigner(), agent, new TipOracle(), storeMock, ctxMock(tracked, settled));

  const sig = await sub.submit(new SelfTransferMemo());
  assert.equal(settled[0]!.failure, "send_rejected");
  fail = false;
  await sub.onFailure(settled[0]!); // what Worker.onSettled does in production
  assert.equal(sent.length, 1);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0]!.retryOf, sig);
  assert.equal(tracked[0]!.tip, 6000);
});

test("onFailure stops after the attempt cap", async () => {
  const sent: string[][] = [];
  const tracked: Lifecycle[] = [];
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT]);
  const agent: DecisionPort = {
    tipPolicy: noTipPolicy,
    async recover() {
      return { action: "resubmit", refreshBlockhash: true, tip: 7000, trace: { reasoning: "x", confidence: 0.5 } };
    },
  };
  const sub = new Submitter(builder, jitoMock(sent), ephemeralSigner(), agent, new TipOracle(), storeMock, ctxMock(tracked));

  await sub.submit(new SelfTransferMemo());
  for (let i = 0; i < 5; i++) {
    const last = tracked[tracked.length - 1]!;
    last.failure = "bundle_dropped";
    await sub.onFailure(last);
  }
  assert.equal(sent.length, 3);
});
