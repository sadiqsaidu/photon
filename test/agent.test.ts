import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/agent/index.js";
import type { LlmClient } from "../src/shared/ports.js";
import type { TipFloor } from "../src/shared/types.js";

const floor: TipFloor = { p25: 1000, p50: 2000, p75: 5000, p95: 10_000, p99: 20_000, ema: 3000 };

function llm(resp: string): LlmClient {
  return { async complete() { return resp; } };
}

test("tipPolicy parses a valid response", async () => {
  const a = new Agent(
    llm(JSON.stringify({ anchor: "p75", multiplier: 1.5, ceiling: 50_000, reasoning: "busy", confidence: 0.8 })),
    "m",
    200_000,
  );
  const p = await a.tipPolicy({ floor, landRate: 0.9, inFlight: 0, slotsToLeader: 3 });
  assert.equal(p.anchor, "p75");
  assert.equal(p.multiplier, 1.5);
  assert.equal(p.trace.reasoning, "busy");
});

test("tipPolicy falls back safely on garbage", async () => {
  const a = new Agent(llm("not json"), "m", 200_000);
  const p = await a.tipPolicy({ floor, landRate: 1, inFlight: 0, slotsToLeader: 0 });
  assert.equal(p.anchor, "p50");
  assert.ok(p.multiplier >= 0.5 && p.multiplier <= 5);
  assert.ok(p.ceiling <= 200_000);
});

test("tipPolicy clamps out-of-range values", async () => {
  const a = new Agent(llm(JSON.stringify({ anchor: "p99", multiplier: 99, ceiling: 999_999_999 })), "m", 200_000);
  const p = await a.tipPolicy({ floor, landRate: 1, inFlight: 0, slotsToLeader: 0 });
  assert.equal(p.multiplier, 5);
  assert.equal(p.ceiling, 200_000);
});

test("recover returns a clamped decision", async () => {
  const a = new Agent(
    llm(JSON.stringify({ action: "resubmit", refreshBlockhash: true, tip: 8000, reasoning: "refresh", confidence: 0.7 })),
    "m",
    200_000,
  );
  const d = await a.recover({ failure: "expired_blockhash", lastTip: 5000, floor, slotsToLeader: 2, attempt: 1 });
  assert.equal(d.action, "resubmit");
  assert.equal(d.refreshBlockhash, true);
  assert.equal(d.tip, 8000);
});
