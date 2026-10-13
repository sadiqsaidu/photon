import { describe, expect, it } from "vitest";
import { supervise } from "../src/stream.js";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("a paused stream", () => {
  it("reports idle with no error and no reconnects while nothing is watched", async () => {
    let sessions = 0;
    const h = supervise("idle-test", async () => {
      sessions++;
      throw new Error("no data for 15 s");
    }, () => false);
    await tick();
    expect(h).toMatchObject({ idle: true, connected: false, error: null, reconnects: 0 });
    expect(sessions).toBe(0);
  });

  it("does not count a session that ends because the last watch expired", async () => {
    let active = true;
    const h = supervise("expire-test", async () => {
      active = false;
      throw new Error("closed 1000");
    }, () => active);
    await tick();
    expect(h).toMatchObject({ idle: true, error: null, reconnects: 0 });
  });
});
