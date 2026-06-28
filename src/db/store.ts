import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./index.js";
import { decisions, lifecycles } from "./schema.js";
import type { DecisionTrace, Lifecycle, Slot, Stage } from "../shared/types.js";

const LOG_DIR = join(process.cwd(), "logs", "lifecycle");

function deltas(l: Lifecycle): Record<string, number> {
  const at = (s: Stage) => l.stages[s]?.at;
  const out: Record<string, number> = {};
  const proc = at("processed");
  const conf = at("confirmed");
  const fin = at("finalized");
  if (proc !== undefined && conf !== undefined) out.processed_to_confirmed_ms = conf - proc;
  if (conf !== undefined && fin !== undefined) out.confirmed_to_finalized_ms = fin - conf;
  return out;
}

function slotOf(l: Lifecycle): Slot | null {
  return l.stages.processed?.slot ?? l.stages.confirmed?.slot ?? l.stages.finalized?.slot ?? null;
}

export class Store {
  constructor(private readonly db: Db) {}

  async saveLifecycle(l: Lifecycle): Promise<void> {
    const d = deltas(l);
    await this.db
      .insert(lifecycles)
      .values({
        signature: l.signature,
        source: l.source,
        payload: l.payload,
        slot: slotOf(l),
        tip: l.tip,
        failure: l.failure,
        stages: l.stages,
        deltas: d,
        trace: l.trace,
      })
      .onConflictDoNothing();
    mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const entry = { ...l, deltas: d, sealedAt: new Date().toISOString() };
    appendFileSync(join(LOG_DIR, `${day}.jsonl`), `${JSON.stringify(entry)}\n`);
  }

  async saveDecision(
    kind: string,
    context: unknown,
    output: unknown,
    trace: DecisionTrace,
  ): Promise<void> {
    await this.db.insert(decisions).values({
      kind,
      context,
      output,
      reasoning: trace.reasoning,
      confidence: trace.confidence,
    });
  }
}
