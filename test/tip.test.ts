import { test } from "node:test";
import assert from "node:assert/strict";
import { TipStream } from "../src/core/tip-stream.js";
import { TipForecaster } from "../src/core/tip-forecast.js";
import { TipOracle } from "../src/core/tip-oracle.js";

test("tip stream computes local percentiles over the slot window", () => {
  const s = new TipStream();
  // 100 samples 1000..100000 across a few slots
  for (let i = 1; i <= 100; i++) s.observe(100 + Math.floor(i / 25), i * 1000);
  assert.equal(s.sampleCount(), 100);
  const p = s.percentiles();
  assert.ok(p.p25 < p.p50 && p.p50 < p.p75 && p.p75 < p.p95 && p.p95 <= p.p99);
  assert.ok(p.p50 >= 45_000 && p.p50 <= 55_000);
});

test("tip stream evicts slots outside the 300-slot window", () => {
  const s = new TipStream();
  s.observe(100, 5000);
  s.observe(100, 6000);
  s.observe(500, 7000); // slot 100 < 500 - 300 -> evicted
  assert.equal(s.sampleCount(), 1);
  assert.equal(s.percentiles().p50, 7000);
});

test("tip stream fires per-slot p50 on slot completion", () => {
  const s = new TipStream();
  const seen: [number, number][] = [];
  s.onSlotP50 = (slot, p50) => seen.push([slot, p50]);
  s.observe(100, 1000);
  s.observe(100, 3000);
  s.observe(101, 9999); // completes slot 100
  assert.equal(seen.length, 1);
  assert.equal(seen[0]![0], 100);
  assert.equal(seen[0]![1], 3000); // p50 of [1000, 3000] (upper index)
});

test("forecaster: rising series forecasts above current p50", () => {
  const f = new TipForecaster();
  for (let i = 0; i < 60; i++) f.observe(10_000 + i * 100);
  const current = 10_000 + 59 * 100;
  const out = f.forecast(8);
  assert.ok(out.p50 > current, `forecast(8)=${out.p50} should exceed current=${current}`);
  assert.ok(out.trendPctPer10Slots > 0);
});

test("forecaster: flat series forecasts about the current value", () => {
  const f = new TipForecaster();
  for (let i = 0; i < 60; i++) f.observe(10_000);
  const out = f.forecast(8);
  assert.ok(Math.abs(out.p50 - 10_000) < 10);
  assert.ok(Math.abs(out.trendPctPer10Slots) < 0.1);
  assert.equal(out.volatility, 0);
});

test("forecaster: clamps to [0.25x, 4x] of current p50", () => {
  const f = new TipForecaster();
  // explosive trend
  for (let i = 0; i < 40; i++) f.observe(1000 * 2 ** Math.min(i, 20));
  const current = 1000 * 2 ** 20;
  const out = f.forecast(100);
  assert.ok(out.p50 <= 4 * current);
});

test("oracle serves REST floor until the local window is deep enough", () => {
  const s = new TipStream();
  const o = new TipOracle(s);
  assert.equal(o.floor().source, "rest");
  for (let i = 0; i < 200; i++) s.observe(100 + Math.floor(i / 10), 5000 + i);
  assert.equal(o.floor().source, "local");
  assert.ok(o.floor().p50 >= 5000);
});

test("oracle land rate is an EWMA over recent settlements, not lifetime", () => {
  const o = new TipOracle();
  assert.equal(o.landRate(), 1);
  for (let i = 0; i < 20; i++) o.observe(true);
  assert.ok(o.landRate() > 0.99);
  // a run of recent failures must drag the rate down fast
  for (let i = 0; i < 5; i++) o.observe(false);
  assert.ok(o.landRate() < 0.25, `rate=${o.landRate()}`);
});
