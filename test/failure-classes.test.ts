import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Receipt } from "../src/lifecycle.js";

const rpcMock = vi.fn();
vi.mock("../src/solami.js", () => ({
  beamRecord: vi.fn(async () => null),
  beamSend: vi.fn(async () => "sig"),
  rpc: (...args: unknown[]) => rpcMock(...args),
}));

const lifecycle = await import("../src/lifecycle.js");

function settledOnce(): Promise<Receipt> {
  return new Promise((resolve) => lifecycle.onReceiptSettled(resolve));
}

describe("leaderSkipped", () => {
  it("needs a gap in the first four slots after send and a later confirmed slot", () => {
    expect(lifecycle.leaderSkipped(100, new Set([101, 102, 103, 104, 105]), 105)).toBe(false);
    expect(lifecycle.leaderSkipped(100, new Set([101, 103, 104, 105]), 105)).toBe(true);
    expect(lifecycle.leaderSkipped(100, new Set([101]), 103)).toBe(false);
  });
});

describe("failure classes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpcMock.mockReset();
  });

  it("finalized transactions settle without a failure", async () => {
    const done = settledOnce();
    lifecycle.track("ok1", "probe", 1_000, 5_000, 100_000);
    lifecycle.onTx("ok1", 1_001, false);
    lifecycle.onSlot(1_001, "confirmed");
    lifecycle.onSlot(1_001, "finalized");
    await vi.runAllTimersAsync();
    const r = await done;
    expect(r.failure).toBeNull();
    expect(Object.keys(r.stages)).toEqual(["submitted", "processed", "confirmed", "finalized"]);
  });

  it("failed_onchain when meta carries an error", async () => {
    const done = settledOnce();
    lifecycle.track("bad1", "probe", 2_000, 5_000, 100_000);
    lifecycle.onTx("bad1", 2_001, true);
    await vi.runAllTimersAsync();
    expect((await done).failure).toBe("failed_onchain");
  });

  it("send_rejected when Beam refuses the send", async () => {
    const done = settledOnce();
    const r = lifecycle.track("rej1", "sdk", 3_000, 5_000, 100_000);
    lifecycle.rejected(r, "tip_too_low");
    await vi.runAllTimersAsync();
    expect((await done).failure).toBe("send_rejected");
  });

  it("expired_blockhash only once streamed height passes lastValidBlockHeight", async () => {
    rpcMock.mockResolvedValue({ value: [null] });
    const done = settledOnce();
    for (let s = 4_001; s <= 4_010; s++) lifecycle.onSlot(s, "confirmed");
    lifecycle.track("exp1", "probe", 4_000, 7_000, 100_000);
    lifecycle.onBlockHeight(7_000);
    expect(rpcMock).not.toHaveBeenCalled();
    lifecycle.onBlockHeight(7_001);
    await vi.runAllTimersAsync();
    expect((await done).failure).toBe("expired_blockhash");
  });

  it("leader_skipped when an early leader slot never confirmed", async () => {
    rpcMock.mockResolvedValue({ value: [null] });
    const done = settledOnce();
    for (const s of [5_001, 5_003, 5_004, 5_005, 5_006]) lifecycle.onSlot(s, "confirmed");
    lifecycle.track("skip1", "probe", 5_000, 8_000, 100_000);
    lifecycle.onBlockHeight(8_001);
    await vi.runAllTimersAsync();
    expect((await done).failure).toBe("leader_skipped");
  });

  it("a landing the stream missed is recovered from signature status", async () => {
    rpcMock.mockResolvedValue({ value: [{ slot: 6_002, err: null, confirmationStatus: "finalized" }] });
    const done = settledOnce();
    lifecycle.track("late1", "probe", 6_000, 9_000, 100_000);
    lifecycle.onBlockHeight(9_001);
    await vi.runAllTimersAsync();
    const r = await done;
    expect(r.failure).toBeNull();
    expect(r.landedSlot).toBe(6_002);
  });
});

describe("beamTipOf", () => {
  it("reads the tip transfer from a probe transaction", async () => {
    const { Keypair, PublicKey } = await import("@solana/web3.js");
    const { buildTx } = await import("../src/probe.js");
    const tipAccount = "15qWd4huAkoxvhDsHMfpUn27TW1YBYMMJJ2jkAkbeam";
    const tx = buildTx(Keypair.generate(), tipAccount, 123_456, new PublicKey(new Uint8Array(32)).toBase58(), "photon-probe");
    expect(lifecycle.beamTipOf(tx, new Set([tipAccount]))).toBe(123_456);
    expect(lifecycle.beamTipOf(tx, new Set())).toBe(0);
  });
});
