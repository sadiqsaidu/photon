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
}

type Session = (health: StreamHealth, signal: AbortSignal) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs one session after another forever: reconnects with exponential backoff
// plus jitter, and aborts a session that goes silent (half-open sockets).
export function supervise(name: string, session: Session): StreamHealth {
  const health: StreamHealth = { name, connected: false, reconnects: 0, lastEventAt: 0, bytes: 0, error: null };
  void (async () => {
    let backoff = 500;
    for (;;) {
      const ctrl = new AbortController();
      const startedAt = Date.now();
      health.lastEventAt = startedAt;
      const watchdog = setInterval(() => {
        if (Date.now() - health.lastEventAt > STREAM_STALE_MS) ctrl.abort(new Error(`no data for ${STREAM_STALE_MS / 1000} s`));
      }, 1_000);
      try {
        await session(health, ctrl.signal);
        health.error = "stream ended";
      } catch (e) {
        health.error = e instanceof Error ? e.message : String(e);
      } finally {
        clearInterval(watchdog);
        ctrl.abort();
      }
      health.connected = false;
      health.reconnects++;
      if (health.lastEventAt - startedAt > 5_000) backoff = 500;
      const delay = Math.round(backoff + Math.random() * backoff * 0.5);
      console.warn(`[${name}] ${health.error}; reconnecting in ${delay} ms`);
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
    ws.on("unexpected-response", (_req, res) => fail(new Error(`HTTP ${res.statusCode} ${res.statusMessage ?? ""}`.trim())));
    ws.on("close", (code, reason) => fail(new Error(`closed ${code} ${reason.toString()}`.trim())));
    ws.on("error", fail);
  });
}
