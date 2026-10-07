import WebSocket from "ws";
import { BACKOFF_MAX_MS, bus, STREAM_STALE_MS } from "./config.js";
import { wsAgent } from "./solami.js";

export interface StreamHealth {
  name: string;
  connected: boolean;
  reconnects: number;
  lastEventAt: number;
  bytes: number;
  error: string | null;
  // Set when Solami refuses the stream (auth, plan or billing); retried slowly.
  blocked: string | null;
  backpressureClosures: number;
  queue?: { depth: number; maxDepth: number; capacity: number; dropped: number };
}

// An error that says why a stream closed, so the supervisor can react.
export function streamError(message: string, kind: { blocked?: boolean; backpressure?: boolean } = {}): Error {
  return Object.assign(new Error(message), kind);
}

const BLOCKED_RETRY_MS = 300_000;

type Session = (health: StreamHealth, signal: AbortSignal) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs one session after another forever: reconnects with exponential backoff
// plus jitter, and aborts a session that goes silent (half-open sockets).
export function supervise(name: string, session: Session): StreamHealth {
  const health: StreamHealth = { name, connected: false, reconnects: 0, lastEventAt: 0, bytes: 0, error: null, blocked: null, backpressureClosures: 0 };
  void (async () => {
    let backoff = 500;
    for (;;) {
      const ctrl = new AbortController();
      const startedAt = Date.now();
      health.lastEventAt = startedAt;
      const watchdog = setInterval(() => {
        if (Date.now() - health.lastEventAt > STREAM_STALE_MS) ctrl.abort(new Error(`no data for ${STREAM_STALE_MS / 1000} s`));
      }, 1_000);
      let blocked = false;
      try {
        await session(health, ctrl.signal);
        health.error = "stream ended";
      } catch (e) {
        const err = e as Error & { blocked?: boolean; backpressure?: boolean };
        health.error = err.message ?? String(e);
        blocked = Boolean(err.blocked);
        if (err.backpressure) health.backpressureClosures++;
      } finally {
        clearInterval(watchdog);
        ctrl.abort();
      }
      health.connected = false;
      health.reconnects++;
      health.blocked = blocked ? health.error : null;
      if (health.lastEventAt - startedAt > 5_000) backoff = 500;
      const delay = blocked ? BLOCKED_RETRY_MS : Math.round(backoff + Math.random() * backoff * 0.5);
      console.warn(`[${name}] ${blocked ? "refused by Solami: " : ""}${health.error}; reconnecting in ${delay} ms`);
      bus.emit("stream", { ...health });
      await sleep(delay);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  })();
  return health;
}

export function wsSession(
  url: string,
  health: StreamHealth,
  signal: AbortSignal,
  onMessage: (data: Buffer, binary: boolean) => void,
  onOpen?: (ws: WebSocket) => void,
): Promise<void> {
  return new Promise((_, reject) => {
    const ws = new WebSocket(url, { agent: wsAgent });
    const fail = (e: Error) => {
      ws.removeAllListeners();
      ws.on("error", () => undefined);
      ws.terminate();
      reject(e);
    };
    signal.addEventListener("abort", () => fail(signal.reason as Error), { once: true });
    ws.on("open", () => {
      health.connected = true;
      health.blocked = null;
      health.lastEventAt = Date.now();
      bus.emit("stream", { ...health });
      onOpen?.(ws);
    });
    ws.on("message", (data: Buffer, binary) => {
      health.lastEventAt = Date.now();
      health.bytes += data.length;
      onMessage(data, binary);
    });
    ws.on("ping", () => (health.lastEventAt = Date.now()));
    // 401/402/403 and close codes 4002 (bandwidth and balance empty) and 4029
    // (stream limit) are refusals, not network faults.
    ws.on("unexpected-response", (_req, res) => {
      const code = res.statusCode ?? 0;
      fail(streamError(`HTTP ${code} ${res.statusMessage ?? ""}`.trim(), { blocked: code === 401 || code === 402 || code === 403 }));
    });
    ws.on("close", (code, reason) => fail(streamError(`closed ${code} ${reason.toString()}`.trim(), { blocked: code === 4002 || code === 4029 })));
    ws.on("error", fail);
  });
}
