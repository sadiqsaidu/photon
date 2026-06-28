import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PublicKey } from "@solana/web3.js";
import { bus } from "../shared/bus.js";
import { BundleBuilder, SelfTransferMemo } from "../core/builder.js";
import type { Submitter } from "../core/submission.js";
import { info } from "../shared/log.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export interface ApiDeps {
  builder: BundleBuilder;
  submitter: Submitter;
  defaultTip: () => number;
  hasSigner: boolean;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS, "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sse(res: ServerResponse): void {
  res.writeHead(200, {
    ...CORS,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(":ok\n\n");
  const unsub = bus.subscribe((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
  const keepalive = setInterval(() => res.write(":ka\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(keepalive);
    unsub();
  });
}

export function createApi(deps: ApiDeps): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true, signer: deps.hasSigner });
        return;
      }
      if (req.method === "GET" && url.pathname === "/events") {
        sse(res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/bundle/prepare") {
        const body = await readJson(req);
        if (typeof body.payer !== "string") {
          send(res, 400, { error: "payer (pubkey) required" });
          return;
        }
        const tip = typeof body.tip === "number" ? body.tip : deps.defaultTip();
        const unsigned = await deps.builder.buildUnsigned(new SelfTransferMemo(), new PublicKey(body.payer), tip);
        send(res, 200, unsigned);
        return;
      }
      if (req.method === "POST" && url.pathname === "/bundle/submit") {
        const body = await readJson(req);
        if (typeof body.signedTx !== "string" || typeof body.signature !== "string") {
          send(res, 400, { error: "signedTx (base64) and signature required" });
          return;
        }
        const bundleId = await deps.submitter.submitSigned({
          signedTx: body.signedTx,
          signature: body.signature,
          tip: typeof body.tip === "number" ? body.tip : 0,
          payloadKind: typeof body.payload === "string" ? body.payload : undefined,
        });
        send(res, 200, { bundleId });
        return;
      }
      if (req.method === "POST" && url.pathname === "/fault") {
        if (!deps.hasSigner) {
          send(res, 503, { error: "no server signer; set WALLET_SECRET for the local fault demo" });
          return;
        }
        const signature = await deps.submitter.submit(new SelfTransferMemo(), { fault: true, ttlMs: 15_000 });
        send(res, 200, { signature });
        return;
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      info("api", "request failed", { path: url.pathname, error: String(e) });
      send(res, 500, { error: String(e) });
    }
  });
}
