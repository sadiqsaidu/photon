import type { BundleGateway, BundleStatus } from "../shared/ports.js";
import type { Slot } from "../shared/types.js";
import { JitoEngine, JitoHttpError } from "./jito.js";
import { info, warn } from "../shared/log.js";

const CALL_TIMEOUT_MS = 2000;
// Jito rate-limits ~1 req/s per IP per region on the free tier. After a 429
// from an engine, skip it in the next fan-out instead of hammering it.
const COOLDOWN_MS = 1500;

export const DEFAULT_JITO_ENGINES = [
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://london.mainnet.block-engine.jito.wtf",
];

// Multi-region fan-out: every call races all (non-cooling) engines and the
// first success wins. Duplicate submission is safe — identical signatures
// land at most once.
export class JitoMulti implements BundleGateway {
  private readonly coolUntil = new Map<string, number>();

  constructor(private readonly engines: JitoEngine[]) {
    if (engines.length === 0) throw new Error("JitoMulti needs at least one engine");
  }

  private available(): JitoEngine[] {
    const now = Date.now();
    const ok = this.engines.filter((e) => (this.coolUntil.get(e.engine) ?? 0) <= now);
    // If every engine is cooling down, trying them all beats guaranteed failure.
    return ok.length > 0 ? ok : this.engines;
  }

  private markRejected(engine: JitoEngine, e: unknown): Error {
    if (e instanceof JitoHttpError && e.status === 429) {
      this.coolUntil.set(engine.engine, Date.now() + COOLDOWN_MS);
      warn("jito", "rate-limited, cooling down", { engine: engine.engine, ms: COOLDOWN_MS });
    }
    return new Error(`${engine.engine}: ${e instanceof Error ? e.message : String(e)}`);
  }

  private async race<T>(fn: (e: JitoEngine, signal: AbortSignal) => Promise<T>): Promise<T> {
    const targets = this.available();
    try {
      return await Promise.any(
        targets.map((e) =>
          fn(e, AbortSignal.timeout(CALL_TIMEOUT_MS)).catch((err: unknown) => {
            throw this.markRejected(e, err);
          }),
        ),
      );
    } catch (e) {
      const errors = e instanceof AggregateError ? e.errors : [e];
      const messages = errors.map((x) => (x instanceof Error ? x.message : String(x)));
      throw new AggregateError(errors, `all Jito engines rejected: ${messages.join(" | ")}`);
    }
  }

  tipAccounts(): Promise<string[]> {
    return this.race((e, signal) => e.tipAccounts(signal));
  }

  nextLeader(): Promise<{ currentSlot: Slot; nextLeaderSlot: Slot }> {
    return this.race((e, signal) => e.nextLeader(signal));
  }

  async sendBundle(base64Txs: string[]): Promise<string> {
    const targets = this.available();
    const failures: Error[] = [];
    try {
      const id = await Promise.any(
        targets.map((e) =>
          e.sendBundle(base64Txs).then(
            (bundleId) => {
              info("jito", "bundle accepted", { engine: e.engine, bundleId });
              return bundleId;
            },
            (err: unknown) => {
              throw this.markRejected(e, err);
            },
          ),
        ),
      );
      return id;
    } catch (e) {
      const errors = e instanceof AggregateError ? e.errors : [e];
      for (const x of errors) failures.push(x instanceof Error ? x : new Error(String(x)));
      const messages = failures.map((x) => x.message);
      throw new AggregateError(failures, `all Jito engines rejected sendBundle: ${messages.join(" | ")}`);
    }
  }

  bundleStatus(id: string): Promise<BundleStatus> {
    return this.race((e, signal) => e.bundleStatus(id, signal));
  }
}
