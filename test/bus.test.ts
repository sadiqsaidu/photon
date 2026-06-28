import { test } from "node:test";
import assert from "node:assert/strict";
import { bus } from "../src/shared/bus.js";

test("bus delivers to subscribers and stops after unsubscribe", () => {
  const got: number[] = [];
  const off = bus.subscribe((e) => {
    if (e.type === "slot") got.push(e.slot);
  });
  bus.publish({ type: "slot", slot: 1, commitment: "processed" });
  off();
  bus.publish({ type: "slot", slot: 2, commitment: "processed" });
  assert.deepEqual(got, [1]);
});
