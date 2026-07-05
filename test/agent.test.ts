import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/agent/index.js";
import type { LlmClient } from "../src/shared/ports.js";
import type { TipFloor } from "../src/shared/types.js";

const floor: TipFloor = { p25: 1000, p50: 2000, p75: 5000, p95: 10_000, p99: 20_000, ema: 3000 };

const forecast = { p50AtLanding: 2200, trendPctPer10Slots: 3, volatility: 0.1 };

function tipCtx(landRate: number, inFlight: number, slotsToLeader: number) {
  return { floor, landRate, inFlight, slotsToLeader, forecast, windowOpen: false, floorSource: "rest" as const };
}

function llm(resp: string): LlmClient {
  return { async complete() { return resp; } };
}

test("tipPolicy parses a valid response", async () => {
  const a = new Agent(
    llm(JSON.stringify({ anchor: "p75", multiplier: 1.5, ceiling: 50_000, reasoning: "busy", confidence: 0.8 })),
    "m",
    200_000,
  );
  const p = await a.tipPolicy(tipCtx(0.9, 0, 3));
  assert.equal(p.anchor, "p75");
  assert.equal(p.multiplier, 1.5);
  assert.equal(p.trace.reasoning, "busy");
});

test("tipPolicy parses JSON wrapped in markdown fences", async () => {
  const fenced = "Here you go:\n```json\n" + JSON.stringify({ anchor: "p95", multiplier: 2, ceiling: 40_000 }) + "\n```";
  const a = new Agent(llm(fenced), "m", 200_000);
  const p = await a.tipPolicy(tipCtx(0.5, 1, 1));
  assert.equal(p.anchor, "p95");
  assert.equal(p.multiplier, 2);
});

test("tipPolicy falls back safely on garbage", async () => {
  const a = new Agent(llm("not json"), "m", 200_000);
  const p = await a.tipPolicy(tipCtx(1, 0, 0));
  assert.equal(p.anchor, "p50");
  assert.ok(p.multiplier >= 0.5 && p.multiplier <= 5);
  assert.ok(p.ceiling <= 200_000);
});

test("tipPolicy clamps out-of-range values", async () => {
  const a = new Agent(llm(JSON.stringify({ anchor: "p99", multiplier: 99, ceiling: 999_999_999 })), "m", 200_000);
  const p = await a.tipPolicy(tipCtx(1, 0, 0));
  assert.equal(p.multiplier, 5);
  assert.equal(p.ceiling, 200_000);
});

test("recover returns a clamped decision", async () => {
  const a = new Agent(
    llm(JSON.stringify({ action: "resubmit", refreshBlockhash: true, tip: 8000, reasoning: "refresh", confidence: 0.7 })),
    "m",
    200_000,
  );
  const d = await a.recover({ failure: "expired_blockhash", lastTip: 5000, floor, slotsToLeader: 2, attempt: 1, blockhashStillValid: false, landedPerBundleStatus: false, targetLeaderSkipped: false });
  assert.equal(d.action, "resubmit");
  assert.equal(d.refreshBlockhash, true);
  assert.equal(d.tip, 8000);
});
