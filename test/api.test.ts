import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApi } from "../src/api/server.js";
import { bus } from "../src/shared/bus.js";
import type { BundleBuilder } from "../src/core/builder.js";
import type { Submitter } from "../src/core/submission.js";

function boot() {
  const server = createApi({
    builder: {} as unknown as BundleBuilder,
    submitter: {} as unknown as Submitter,
    defaultTip: () => 1000,
    hasSigner: false,
  });
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://localhost:${port}` };
}

test("GET /health reports status", async () => {
  const { server, base } = boot();
  try {
    const body = (await (await fetch(`${base}/health`)).json()) as { ok: boolean; signer: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.signer, false);
  } finally {
    server.close();
  }
});

test("GET /events streams bus events over SSE", async () => {
  const { server, base } = boot();
  const ctrl = new AbortController();
  try {
    const resp = await fetch(`${base}/events`, { signal: ctrl.signal });
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    bus.publish({ type: "slot", slot: 42, commitment: "processed" });

    let buf = "";
    const deadline = Date.now() + 2000;
    let found = false;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      if (buf.includes('"slot":42')) {
        found = true;
        break;
      }
    }
    assert.ok(found, "expected slot event over SSE");
  } finally {
    ctrl.abort();
    server.close();
  }
});
