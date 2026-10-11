import http from "node:http";
import { bus, config } from "./config.js";

export interface Request {
  params: string[];
  query: URLSearchParams;
  body: unknown;
  raw: Buffer;
  headers: http.IncomingHttpHeaders;
  ip: string;
}

export type Handler = (req: Request) => Promise<unknown> | unknown;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// At most `max` hits per key in any `windowMs`. `wait` reports the seconds
// until the next hit is allowed without recording one.
export function limiter(max: number, windowMs: number, now = () => Date.now()) {
  const hits = new Map<string, number[]>();
  const recent = (key: string) => {
    const t = now();
    const list = (hits.get(key) ?? []).filter((at) => at > t - windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };
  return {
    wait(key: string): number {
      const list = recent(key);
      return list.length < max ? 0 : Math.max(1, Math.ceil(((list[0] as number) + windowMs - now()) / 1000));
    },
    hit(key: string): void {
      hits.set(key, [...recent(key), now()]);
    },
  };
}

// The reverse proxy (Caddy) sets x-forwarded-for; its first entry is the client.
function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

function cors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = (req.headers.origin ?? "").replace(/\/$/, "");
  if (!config.allowedOrigins.length) res.setHeader("access-control-allow-origin", "*");
  else if (config.allowedOrigins.includes(origin)) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "origin");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

const SSE_EVENTS = ["slot", "tips", "heat", "lag", "quote", "fares", "products", "probe", "lifecycle", "stream", "audit"];
const MAX_BODY = 256 * 1024;

function readBody(req: http.IncomingMessage): Promise<{ raw: Buffer; body: unknown }> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new HttpError(413, "body too large"));
      else chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve({ raw, body: undefined });
      try {
        resolve({ raw, body: JSON.parse(raw.toString()) });
      } catch {
        reject(new HttpError(400, "body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sse(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(": tipwise\n\n");
  const listeners = SSE_EVENTS.map((event) => {
    const fn = (data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    bus.on(event, fn);
    return [event, fn] as const;
  });
  const keepalive = setInterval(() => res.write(": ping\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(keepalive);
    for (const [event, fn] of listeners) bus.off(event, fn);
  });
}

// Routes are "METHOD /path/:param"; params are passed positionally.
export function startServer(routes: Record<string, Handler>): http.Server {
  const table = Object.entries(routes).map(([key, handler]) => {
    const [method, path] = key.split(" ") as [string, string];
    const pattern = new RegExp(`^${path.replace(/:[a-z]+/g, "([^/]+)")}$`);
    return { method, pattern, handler };
  });
  const server = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/events") return sse(res);
    const route = table.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    try {
      if (!route) throw new HttpError(404, "not found");
      const params = (url.pathname.match(route.pattern) ?? []).slice(1).map(decodeURIComponent);
      const { raw, body } = await readBody(req);
      const out = await route.handler({ params, query: url.searchParams, body, raw, headers: req.headers, ip: clientIp(req) });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(`[api] ${req.method} ${url.pathname}: ${(e as Error).message}`);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message, ...(e instanceof HttpError ? e.extra : {}) }));
    }
  });
  server.listen(config.port, "0.0.0.0", () => console.log(`[api] listening on 0.0.0.0:${config.port}`));
  return server;
}
