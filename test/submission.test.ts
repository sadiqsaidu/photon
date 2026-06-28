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

function ctxMock(tracked: Lifecycle[]): SubmitContext {
  return {
    track(l) { tracked.push(l); },
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

  const bundleId = await sub.submitSigned({ signedTx: "QkFTRTY0", signature: "sigExt", tip: 4000 });
  assert.equal(sent.length, 1);
  assert.equal(bundleId, "bundle-1");
  assert.equal(tracked[0]!.signature, "sigExt");
  assert.equal(tracked[0]!.source, "submitted");

  const l = tracked[0]!;
  l.failure = "bundle_dropped";
  await sub.onFailure(l);
  assert.equal(sent.length, 1);
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
