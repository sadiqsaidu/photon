"use client";

import { recentLifecycles, useStore, type Lifecycle } from "@/lib/store";
import { STAGES, type Stage } from "@/lib/events";
import { shortSig } from "@/lib/format";

function delta(l: Lifecycle, from: Stage, to: Stage): string {
  const a = l.stages[from]?.at;
  const b = l.stages[to]?.at;
  if (a === undefined || b === undefined) return "";
  return `+${b - a}ms`;
}

export function LifecycleStrip() {
  const { state } = useStore();
  const recent = recentLifecycles(state);
  const active = recent[0];

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <span className="label">transaction journey</span>
        <span className="text-[11px] text-zinc-500">{active ? shortSig(active.signature) : "awaiting activity"}</span>
      </div>

      <div className="flex items-center">
        {STAGES.map((stage, i) => {
          const reached = Boolean(active?.stages[stage]);
          const failed = Boolean(active?.failure) && !reached;
          return (
            <div key={stage} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full transition-colors duration-500 ${
                    reached ? "bg-accent glow" : failed ? "bg-fail" : "bg-white/10"
                  }`}
                />
                <span className={`text-[11px] ${reached ? "text-zinc-200" : "text-zinc-600"}`}>{stage}</span>
              </div>
              {i < STAGES.length - 1 && (
                <div className="flex flex-1 flex-col items-center px-1">
                  <div
                    className={`h-px w-full transition-colors duration-500 ${
                      active?.stages[STAGES[i + 1]] ? "bg-accent/60" : "bg-white/[0.06]"
                    }`}
                  />
                  <span className="mt-1 h-3 text-[10px] tabular-nums text-zinc-500">
                    {active ? delta(active, stage, STAGES[i + 1]) : ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {active?.failure && (
        <div className="mt-3 text-[11px] text-fail">failure · {active.failure.replace(/_/g, " ")}</div>
      )}
    </div>
  );
}
