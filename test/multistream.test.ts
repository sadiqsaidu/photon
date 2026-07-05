import { test } from "node:test";
import assert from "node:assert/strict";
import { MultiStream } from "../src/adapters/multistream.js";
import type { RawStreamProvider } from "../src/shared/ports.js";
import type { StreamEvent, TaggedStreamEvent } from "../src/shared/types.js";

class FakeProvider implements RawStreamProvider {
  connected = true;
  reconnects = 0;
  private items: TaggedStreamEvent[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  constructor(readonly name: string) {}

  emit(event: StreamEvent, recvAt = Date.now()): void {
    this.items.push({ event, provider: this.name, recvAt });
    this.wake?.();
    this.wake = null;
  }

  async *raw(): AsyncIterable<TaggedStreamEvent> {
    for (;;) {
      while (this.items.length) yield this.items.shift() as TaggedStreamEvent;
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }

  forceReconnect(): void {
    this.reconnects++;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    this.wake?.();
    this.wake = null;
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r));

async function collect(stream: MultiStream, n: number, timeoutMs = 500): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  const it = stream.events()[Symbol.asyncIterator]();
  while (out.length < n && Date.now() < deadline) {
    const next = await Promise.race([
      it.next(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now())),
      ),
    ]);
    if (next.done) break;
    out.push(next.value as StreamEvent);
  }
  return out;
}

const slot = (n: number): StreamEvent => ({ kind: "slot", slot: n, parent: n - 1, commitment: "processed" });
const tx = (sig: string): StreamEvent => ({ kind: "tx", signature: sig, slot: 1, err: null });

test("same event from two providers 30ms apart -> one downstream, winner credited, delta recorded", async () => {
  const a = new FakeProvider("A");
  const b = new FakeProvider("B");
  const m = new MultiStream([a, b]);

  const t0 = Date.now();
  a.emit(slot(100), t0);
  await tick();
  b.emit(slot(100), t0 + 30);
  await tick();

  const events = await collect(m, 2, 100);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], slot(100));

  const snap = m.raceSnapshot();
  assert.equal(snap.A?.wins, 1);
  assert.equal(snap.A?.losses, 0);
  assert.equal(snap.B?.wins, 0);
  assert.equal(snap.B?.losses, 1);
  await m.close();
});

test("killing provider A mid-stream leaves provider B flowing with zero gap", async () => {
  const a = new FakeProvider("A");
  const b = new FakeProvider("B");
  const m = new MultiStream([a, b]);

  a.emit(slot(1));
  await tick();
  await a.close();
  b.emit(slot(2));
  b.emit(slot(3));
  b.emit(tx("sigX"));
  await tick();

  const events = await collect(m, 4, 200);
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((e) => (e.kind === "slot" ? e.slot : e.kind === "tx" ? e.signature : e.kind)),
    [1, 2, 3, "sigX"],
  );
  const snap = m.raceSnapshot();
  assert.equal(snap.B?.wins, 3);
  await m.close();
});

test("backpressure sheds slot events before tx events and counts drops", async () => {
  const a = new FakeProvider("A");
  const m = new MultiStream([a]);

  const CAP = 8192;
  const SLOTS = 100;
  for (let i = 0; i < SLOTS; i++) a.emit(slot(i + 1));
  for (let i = 0; i < CAP; i++) a.emit(tx(`sig${i}`));
  await tick();

  assert.equal(m.dropped, SLOTS); // every slot event was shed first
  const events = await collect(m, CAP + SLOTS, 2000);
  assert.equal(events.length, CAP);
  assert.ok(events.every((e) => e.kind === "tx"), "only tx events should survive");
  await m.close();
});

test("LRU does not re-admit an old duplicate within the window", async () => {
  const a = new FakeProvider("A");
  const b = new FakeProvider("B");
  const m = new MultiStream([a, b]);

  a.emit(tx("dup"));
  await tick();
  // push plenty of unique keys, but fewer than the 8192-entry tx LRU
  for (let i = 0; i < 500; i++) a.emit(tx(`sig${i}`));
  await tick();
  b.emit(tx("dup"));
  await tick();

  const events = await collect(m, 502, 500);
  assert.equal(events.length, 501); // dup admitted exactly once
  const snap = m.raceSnapshot();
  assert.equal(snap.B?.losses, 1);
  assert.equal(snap.B?.wins, 0);
  await m.close();
});
