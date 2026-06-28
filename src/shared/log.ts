import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Lifecycle, Stage } from "./types.js";

const LOG_DIR = join(process.cwd(), "logs", "lifecycle");

export function info(scope: string, msg: string, data?: unknown): void {
  const line = data === undefined ? msg : `${msg} ${JSON.stringify(data)}`;
  process.stdout.write(`${new Date().toISOString()} [${scope}] ${line}\n`);
}

export function warn(scope: string, msg: string, data?: unknown): void {
  const line = data === undefined ? msg : `${msg} ${JSON.stringify(data)}`;
  process.stderr.write(`${new Date().toISOString()} [${scope}] WARN ${line}\n`);
}

function deltas(l: Lifecycle): Record<string, number> {
  const at = (s: Stage) => l.stages[s]?.at;
  const out: Record<string, number> = {};
  const sub = at("submitted");
  const proc = at("processed");
  const conf = at("confirmed");
  const fin = at("finalized");
  if (sub !== undefined && proc !== undefined) out.submit_to_processed_ms = proc - sub;
  if (proc !== undefined && conf !== undefined) out.processed_to_confirmed_ms = conf - proc;
  if (conf !== undefined && fin !== undefined) out.confirmed_to_finalized_ms = fin - conf;
  return out;
}

export function record(l: Lifecycle): void {
  mkdirSync(LOG_DIR, { recursive: true });
  const entry = {
    signature: l.signature,
    bundleId: l.bundleId,
    payload: l.payload,
    tip: l.tip,
    retryOf: l.retryOf,
    failure: l.failure,
    stages: l.stages,
    deltas: deltas(l),
    trace: l.trace,
    sealedAt: new Date().toISOString(),
  };
  const day = new Date().toISOString().slice(0, 10);
  appendFileSync(join(LOG_DIR, `${day}.jsonl`), `${JSON.stringify(entry)}\n`);
  info("lifecycle", "sealed", { signature: l.signature, failure: l.failure, deltas: entry.deltas });
}
