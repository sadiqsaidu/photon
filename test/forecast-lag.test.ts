import { describe, expect, it } from "vitest";
import { computeLag, holt, pearson, percentile, rankOf } from "../src/tips.js";

describe("percentile and rank", () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it("uses nearest rank", () => {
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 90)).toBe(90);
    expect(percentile(sorted, 100)).toBe(100);
    expect(percentile([], 50)).toBe(0);
  });

  it("ranks a value by the share of samples below it", () => {
    expect(rankOf(sorted, 5)).toBe(0);
    expect(rankOf(sorted, 55)).toBe(50);
    expect(rankOf(sorted, 1_000)).toBe(100);
  });
});

describe("pearson", () => {
  it("is 1 for a perfect line and 0 for a constant series", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
  });
});

describe("computeLag", () => {
  it("finds the slot offset at which heat leads tips", () => {
    const heat = Array.from({ length: 300 }, (_, i) => ((i * 7919) % 13) + (i % 5 === 0 ? 20 : 0));
    const rows = heat.map((h, i) => ({ slot: 1_000 + i, heat: h, p75: 1_000 + 100 * (heat[i - 3] ?? 0) }));
    const lag = computeLag(rows);
    expect(lag.k).toBe(3);
    expect(lag.r).toBeGreaterThan(0.99);
    expect(lag.qualifies).toBe(true);
    expect(lag.beta).toBeGreaterThan(0);
  });

  it("does not qualify uncorrelated series", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ slot: i, heat: (i * 37) % 11, p75: 5_000 + ((i * 53) % 17) }));
    expect(computeLag(rows).qualifies).toBe(false);
  });
});

describe("holt", () => {
  it("projects a rising series upward and a flat one flat", () => {
    const up = holt();
    for (let i = 1; i <= 50; i++) up.observe(1_000 + i * 10);
    expect(up.growth(10)).toBeGreaterThan(1);

    const flat = holt();
    for (let i = 0; i < 50; i++) flat.observe(5_000);
    expect(flat.growth(10)).toBeCloseTo(1);
  });
});
