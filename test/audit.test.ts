import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { analyze, summarize, tipPaid, type RpcTx } from "../src/audit.js";
import type { SlotStats } from "../src/tips.js";

const WALLET = "HWXFP33wwJKapxzYzroD14CYktftug5PQBBc6UWZCr5H";
const TIP = "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5";
const OTHER = "9omGCCCnYg9GvEBkqamCmGR3ueWrXFVkCiReo4gN3Gq8";
const SYSTEM = "11111111111111111111111111111111";

function transfer(lamports: number): string {
  const data = Buffer.alloc(12);
  data.writeUInt32LE(2, 0);
  data.writeBigUInt64LE(BigInt(lamports), 4);
  return bs58.encode(data);
}

function tx(slot: number, tips: number[], opts: { fee?: number; err?: unknown; inner?: number; to?: string } = {}): RpcTx {
  const keys = [WALLET, opts.to ?? TIP, SYSTEM];
  return {
    slot,
    blockTime: 1_700_000_000,
    transaction: {
      signatures: [`sig${slot}`],
      message: { accountKeys: keys, instructions: tips.map((t) => ({ programIdIndex: 2, accounts: [0, 1], data: transfer(t) })) },
    },
    meta: {
      err: opts.err ?? null,
      fee: opts.fee ?? 5_000,
      innerInstructions: opts.inner ? [{ instructions: [{ programIdIndex: 2, accounts: [0, 1], data: transfer(opts.inner) }] }] : [],
    },
  };
}

const row = (slot: number, p25: number, p50: number): SlotStats => ({ slot, leader: null, count: 10, beamCount: 0, p25, p50, p75: p50 * 2, p90: p50 * 3, max: p50 * 4, heat: 0 });
const tips = new Set([TIP]);

describe("tipPaid", () => {
  it("sums top-level and CPI transfers from the wallet to tip accounts", () => {
    expect(tipPaid(tx(1, [2_000_000]), WALLET, tips)).toBe(2_000_000);
    expect(tipPaid(tx(1, [1_000], { inner: 500 }), WALLET, tips)).toBe(1_500);
  });
  it("ignores transfers to other accounts and from other wallets", () => {
    expect(tipPaid(tx(1, [2_000_000], { to: OTHER }), WALLET, tips)).toBe(0);
    expect(tipPaid(tx(1, [2_000_000]), OTHER, tips)).toBe(0);
  });
});

describe("analyze and summarize", () => {
  const bench = new Map([
    [10, row(10, 1_000, 5_000)],
    [11, row(11, 3_000_000, 4_000_000)],
  ]);

  it("measures overpay against the slot median and underpay against p25", () => {
    const quiet = analyze(tx(10, [2_000_000], { fee: 25_000 }), WALLET, tips, bench);
    expect(quiet.overpay).toBe(1_995_000);
    expect(quiet.underpaid).toBe(false);
    expect(quiet.priorityFee).toBe(20_000);

    const busy = analyze(tx(11, [2_000_000]), WALLET, tips, bench);
    expect(busy.overpay).toBe(0);
    expect(busy.underpaid).toBe(true);
  });

  it("leaves transactions without a benchmark unscored", () => {
    const a = analyze(tx(99, [2_000_000]), WALLET, tips, bench);
    expect(a.slotP50).toBeNull();
    expect(a.overpay).toBe(0);
    expect(a.underpaid).toBe(false);
  });

  it("summarizes totals, USD only with a price, and the worst offenders", () => {
    const txs = [tx(10, [2_000_000]), tx(11, [2_000_000]), tx(12, [])].map((t) => analyze(t, WALLET, tips, bench));
    const s = summarize(txs, 100);
    expect(s).toMatchObject({ analyzed: 3, tipped: 2, totalTipsLamports: 4_000_000, overpayLamports: 1_995_000, underpaidCount: 1 });
    expect(s.overpayUsd).toBeCloseTo(0.2);
    expect(s.worst[0]?.slot).toBe(10);
    expect(summarize(txs, null).overpayUsd).toBeNull();
  });
});
