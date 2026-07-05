"use client";

import { useEffect, useState } from "react";
import { recentLifecycles, useStore, type Lifecycle, type AgentEntry } from "@/lib/store";
import { STAGES } from "@/lib/events";
import { ago, shortSig, sol } from "@/lib/format";

const GATES = [8, 38, 68, 96]; // % position of the four stage gates

// Progress along the lane: eases toward the next gate while a stage is live.
function progress(l: Lifecycle, now: number): number {
  let idx = -1;
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (l.stages[STAGES[i]!]) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return 0;
  const start = GATES[idx]!;
  if (idx === STAGES.length - 1 || l.failure) return start;
  const end = GATES[idx + 1]!;
  const at = l.stages[STAGES[idx]!]!.at;
  const eased = Math.min(0.85, (now - at) / 12_000); // drift toward the next gate
  return start + (end - start) * eased;
}

function laneState(l: Lifecycle): "landed" | "failed" | "live" {
  if (l.failure) return "failed";
  if (l.stages.finalized) return "landed";
  return "live";
}

function Lane({ l, recovery, now }: { l: Lifecycle; recovery: AgentEntry | undefined; now: number }) {
  const st = laneState(l);
  const p = progress(l, now);
  const dotColor = st === "failed" ? "bg-ember" : st === "landed" ? "bg-moss" : "bg-bone";

  return (
    <div className="rise-in group relative px-4 py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between text-[10px]">
        <span className="flex items-baseline gap-2">
          <span className={l.source === "submitted" ? "text-bone" : "text-bone-faint"}>
            {shortSig(l.signature)}
          </span>
          {l.source === "submitted" && <span className="tag-ghost">yours</span>}
          {l.retryOf && <span className="text-bone-faint">↳ retry of {shortSig(l.retryOf)}</span>}
        </span>
        <span className="flex items-baseline gap-2 tabular-nums">
          {l.tip > 0 && <span className="text-bone-faint">{sol(l.tip)} tip</span>}
          {st === "failed" ? (
            <span className="text-ember">{l.failure}</span>
          ) : st === "landed" ? (
            <span className="text-moss">landed</span>
          ) : (
            <span className="text-bone-dim">in flight · {ago(l.updated)}</span>
          )}
        </span>
      </div>

      {/* the lane */}
      <div className="relative h-4">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        {/* progress trail */}
        <div
          className={`absolute top-1/2 h-px -translate-y-1/2 transition-all duration-1000 ease-out ${
            st === "failed" ? "bg-ember/60" : st === "landed" ? "bg-moss/60" : "bg-bone/40"
          }`}
          style={{ left: `${GATES[0]}%`, width: `${Math.max(0, p - GATES[0]!)}%` }}
        />
        {/* stage gates */}
        {GATES.map((g, i) => {
          const reached = Boolean(l.stages[STAGES[i]!]);
          return (
            <span
              key={g}
              className={`absolute top-1/2 h-2 w-px -translate-y-1/2 ${reached ? "bg-bone-dim" : "bg-line-bright"}`}
              style={{ left: `${g}%` }}
            />
          );
        })}
        {/* the tracer particle */}
        <span
          className={`absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-1000 ease-out ${dotColor} ${
            st === "live" ? "tracer-dot" : ""
          }`}
          style={{ left: `${p}%` }}
        />
      </div>

      {/* the mind, attached at the failure — not in a side panel */}
      {recovery && (
        <div className="mt-1.5 border-l border-ember-dim pl-2.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ember">
            ⟲ the mind · {recovery.action}
          </span>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-bone-faint">{recovery.reasoning}</p>
        </div>
      )}
    </div>
  );
}

// Every tracked signature is a tracer flying toward finalization. Failures
// stall in red and grow the agent's recovery verdict in place.
export function Tracers() {
  const { state } = useStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const all = recentLifecycles(state);
  const yours = all.filter((l) => l.source === "submitted").slice(0, 6);
  const observed = all.filter((l) => l.source === "observed").slice(0, Math.max(2, 8 - yours.length));
  const lanes = [...yours, ...observed];
  const recoveryBySig = new Map<string, AgentEntry>();
  for (const a of state.agent) {
    if (a.kind === "recovery" && !recoveryBySig.has(a.signature)) recoveryBySig.set(a.signature, a);
  }

  return (
    <div className="panel flex-1">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="label">tracers · submitted → processed → confirmed → finalized</span>
        <span className="text-[10px] tabular-nums text-bone-faint">{all.length} tracked</span>
      </div>
      <div className="mt-1 divide-y divide-line/60">
        {lanes.length === 0 ? (
          <div className="px-4 py-8 text-center text-[11px] text-bone-ghost">
            no tracers yet — the stream will populate this, or submit a bundle
          </div>
        ) : (
          lanes.map((l) => <Lane key={l.signature} l={l} recovery={recoveryBySig.get(l.signature)} now={now} />)
        )}
      </div>
    </div>
  );
}
