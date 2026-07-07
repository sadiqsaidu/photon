import { test } from "node:test";
import assert from "node:assert/strict";
import { LeaderWindow, type LeaderRpc } from "../src/core/leader.js";

// slots 1000..1019: A A A A J1 J1 J1 J1 B B B B J2 J2 J2 J2 J3 J3 J3 J3
const IDS = ["A", "J1", "B", "J2", "J3"].flatMap((id) => [id, id, id, id]);

const rpc: LeaderRpc = {
  async slotLeaders(start: number, limit: number) {
    return Array.from({ length: limit }, (_, i) => IDS[(start - 1000 + i) % IDS.length] as string);
  },
  async epochInfo() {
    return { epoch: 7, slotIndex: 0, slotsInEpoch: 20, absoluteSlot: 1000 };
  },
};

const isJito = (id: string) => id.startsWith("J");
const tick = () => new Promise((r) => setTimeout(r, 5));

test("leader windows derive locally from schedule + validator set (no Jito HTTP)", async () => {
  const w = new LeaderWindow(rpc, isJito);
  w.start();
  await tick(); // schedule fetch

  w.observe(1001);
  const s = w.status();
  assert.equal(s.slotsToLeader, 3); // next Jito window starts at 1004
  assert.equal(s.leaderIdentity, "J1");
  assert.equal(s.open, false);
  assert.deepEqual(w.window(), { start: 1004, end: 1007 });

  const windows = w.upcomingWindows(3);
  assert.deepEqual(
    windows.map((x) => [x.start, x.end, x.identity]),
    [
      [1004, 1007, "J1"],
      [1012, 1015, "J2"],
      [1016, 1019, "J3"],
    ],
  );

  w.observe(1005); // inside J1's window
  assert.equal(w.status().open, true);

  w.observe(1008); // window passed -> retarget J2
  assert.equal(w.status().open, false);
  assert.equal(w.status().leaderIdentity, "J2");
  assert.equal(w.status().slotsToLeader, 4);

  w.close();
});

test("onceWindowOpen fires when the window flips open", async () => {
  const w = new LeaderWindow(rpc, isJito);
  w.start();
  await tick();
  let fired = 0;
  w.onceWindowOpen(() => fired++);
  w.observe(1001);
  assert.equal(fired, 0);
  w.observe(1004);
  assert.equal(fired, 1);
  w.observe(1005); // still open: one-shot must not refire
  assert.equal(fired, 1);
  w.close();
});
