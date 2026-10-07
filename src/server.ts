import http from "node:http";
import { bus, config } from "./config.js";

export type Handler = (req: { params: string[]; query: URLSearchParams; body: unknown }) => Promise<unknown> | unknown;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SSE_EVENTS = ["slot", "tips", "heat", "lag", "quote", "probe", "lifecycle", "stream", "audit"];
const MAX_BODY = 256 * 1024;

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new HttpError(413, "body too large"));
      else chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new HttpError(400, "body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sse(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(": photon\n\n");
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
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/events") return sse(res);
    const route = table.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    try {
      if (!route) throw new HttpError(404, "not found");
      const params = (url.pathname.match(route.pattern) ?? []).slice(1).map(decodeURIComponent);
      const out = await route.handler({ params, query: url.searchParams, body: await readBody(req) });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(`[api] ${req.method} ${url.pathname}: ${(e as Error).message}`);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  server.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
  return server;
}
