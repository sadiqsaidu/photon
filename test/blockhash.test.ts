import { test } from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { BlockhashCache } from "../src/core/blockhash.js";
import { BLOCKHASH_VALID_BLOCKS } from "../src/core/constants.js";
import { BundleBuilder, SelfTransferMemo } from "../src/core/builder.js";
import { Submitter, type SubmitContext } from "../src/core/submission.js";
import { ephemeralSigner } from "../src/adapters/signer.js";
import { TipOracle } from "../src/core/tip-oracle.js";
import type { BundleGateway, DecisionPort, RpcGateway } from "../src/shared/ports.js";
import type { Lifecycle } from "../src/shared/types.js";
import type { Store } from "../src/db/store.js";

const TIP_ACCOUNT = "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5";
const HASH = bs58.encode(new Uint8Array(32).fill(7));

function countingRpc(): RpcGateway & { calls: number } {
  return {
    calls: 0,
    async latestBlockhash() {
      this.calls++;
      return { blockhash: bs58.encode(new Uint8Array(32).fill(1)), lastValidBlockHeight: 1000 };
    },
    async blockHeight() {
      this.calls++;
      return 1000;
    },
  };
}

test("cache: fresh() carries lastValidBlockHeight = blockHeight + 150", () => {
  const c = new BlockhashCache();
  assert.equal(c.fresh(), null);
  c.onBlock({ slot: 100, blockhash: HASH, blockHeight: 90 });
  assert.deepEqual(c.fresh(), { blockhash: HASH, lastValidBlockHeight: 90 + BLOCKHASH_VALID_BLOCKS });
  assert.equal(c.currentHeight(), 90);
  assert.equal(c.isValid(90), true);
  assert.equal(c.isValid(89), false);
});

test("cache: stale entries (>2s) are not served", () => {
  const c = new BlockhashCache();
  c.onBlock({ slot: 100, blockhash: HASH, blockHeight: 90 }, Date.now() - 3000);
  assert.equal(c.fresh(), null);
  assert.equal(c.currentHeight(), 90); // height knowledge does not go stale
});

test("cache: keeps the newest slot and monotonic height", () => {
  const c = new BlockhashCache();
  c.onBlock({ slot: 101, blockhash: HASH, blockHeight: 91 });
  c.onBlock({ slot: 100, blockhash: "older", blockHeight: 90 }); // late arrival
  assert.equal(c.fresh()?.blockhash, HASH);
  assert.equal(c.currentHeight(), 91);
});

function jitoMock(): BundleGateway {
  return {
    async tipAccounts() {
      return [TIP_ACCOUNT];
    },
    async nextLeader() {
      return { currentSlot: 1, nextLeaderSlot: 2 };
    },
    async sendBundle() {
      return "bundle-1";
    },
    async bundleStatus() {
      return { landed: false, slot: null, err: null };
    },
  };
}

const storeMock = { async saveLifecycle() {}, async saveDecision() {} } as unknown as Store;

function ctxMock(tracked: Lifecycle[]): SubmitContext {
  return {
    track(l) {
      tracked.push(l);
    },
    settleNow() {},
    tip() {
      return { tip: 5000, trace: null };
    },
    slotsToLeader() {
      return 2;
    },
  };
}

const agentMock: DecisionPort = {
  async tipPolicy() {
    throw new Error("not used");
  },
  async recover() {
    throw new Error("not used");
  },
};

test("submit performs zero RPC calls once the blockhash cache is warm", async () => {
  const rpc = countingRpc();
  const cache = new BlockhashCache();
  cache.onBlock({ slot: 100, blockhash: HASH, blockHeight: 90 });
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT], cache);
  const tracked: Lifecycle[] = [];
  const sub = new Submitter(builder, jitoMock(), ephemeralSigner(), agentMock, new TipOracle(), storeMock, ctxMock(tracked));

  await sub.submit(new SelfTransferMemo());
  assert.equal(rpc.calls, 0);
  assert.equal(tracked[0]!.blockhashSource, "stream");
  assert.equal(tracked[0]!.lastValidBlockHeight, 90 + BLOCKHASH_VALID_BLOCKS);
});

test("buildUnsigned: standard mode signs RPC confirmed; turbo opts into the streamed tip hash", async () => {
  const rpc = countingRpc();
  const cache = new BlockhashCache();
  cache.onBlock({ slot: 100, blockhash: HASH, blockHeight: 90 });
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT], cache);
  const payer = new PublicKey(ephemeralSigner().publicKey);

  const standard = await builder.buildUnsigned(new SelfTransferMemo(), payer, 5000);
  assert.equal(standard.blockhashSource, "rpc"); // safe default even with a warm cache
  assert.equal(rpc.calls, 1);

  const turbo = await builder.buildUnsigned(new SelfTransferMemo(), payer, 5000, { turbo: true });
  assert.equal(turbo.blockhashSource, "stream");
  assert.equal(turbo.blockhash, HASH);
  assert.equal(rpc.calls, 1); // no extra RPC on the turbo path
});

test("submit falls back to RPC when the cache is cold", async () => {
  const rpc = countingRpc();
  const builder = new BundleBuilder(rpc, [TIP_ACCOUNT], new BlockhashCache());
  const tracked: Lifecycle[] = [];
  const sub = new Submitter(builder, jitoMock(), ephemeralSigner(), agentMock, new TipOracle(), storeMock, ctxMock(tracked));

  await sub.submit(new SelfTransferMemo());
  assert.equal(rpc.calls, 1);
  assert.equal(tracked[0]!.blockhashSource, "rpc");
  assert.equal(tracked[0]!.lastValidBlockHeight, 1000);
});
