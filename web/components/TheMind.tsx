"use client";

import { useStore } from "@/lib/store";
import { ago, shortSig } from "@/lib/format";

export function TheMind() {
  const { state } = useStore();
  const entries = state.agent;
  const policy = state.tipPolicy;

  return (
    <div className="card flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">the mind</span>
        <span className="text-[11px] text-zinc-500">agent reasoning · live</span>
      </div>

      {policy && (
        <div className="mb-3 rounded-md border border-accent/20 bg-accent/[0.04] p-2.5">
          <div className="text-[11px] font-medium text-accent">
            tip policy · {policy.anchor} × {policy.multiplier}
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-zinc-400">{policy.reasoning}</div>
        </div>
      )}

      <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
        {entries.length === 0 && <div className="text-[12px] text-zinc-600">no decisions yet…</div>}
        {entries.map((e, i) => (
          <div key={`${e.signature}-${i}`} className="border-b border-white/[0.04] pb-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className={`font-medium ${e.kind === "recovery" ? "text-fail" : "text-zinc-300"}`}>
                {e.kind.replace(/_/g, " ")} · {e.action}
              </span>
              <span className="num text-zinc-600">{ago(e.at)}</span>
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-zinc-500">{e.reasoning}</div>
            <div className="num mt-1 text-[10px] text-zinc-600">
              {shortSig(e.signature)} · conf {Math.round(e.confidence * 100)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
