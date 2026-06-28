"use client";

import { counts, useStore } from "@/lib/store";
import { ms, sol } from "@/lib/format";

export function StatusCards() {
  const { state } = useStore();
  const c = counts(state);
  const tip = state.tipPolicy;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div className="card">
        <div className="label">slot</div>
        <div className="stat mt-1 text-accent">{state.slot.toLocaleString()}</div>
        <div className="mt-3 flex justify-between text-[11px] text-zinc-500">
          <span>commitment</span>
          <span className="text-zinc-300">{state.commitment}</span>
        </div>
      </div>

      <div className="card">
        <div className="label">submissions</div>
        <div className="stat mt-1">{c.landed + c.failed + c.inFlight}</div>
        <div className="mt-3 grid grid-cols-3 gap-1 text-[11px]">
          <span className="text-accent">{c.landed} landed</span>
          <span className="text-zinc-400">{c.inFlight} live</span>
          <span className="text-fail">{c.failed} failed</span>
        </div>
      </div>

      <div className="card">
        <div className="label">tip policy</div>
        <div className="stat mt-1 text-accent">{tip ? sol(tip.tip) : "—"}</div>
        <div className="mt-3 flex justify-between text-[11px] text-zinc-500">
          <span>{tip ? `${tip.anchor} × ${tip.multiplier}` : "awaiting agent"}</span>
          <span>SOL</span>
        </div>
      </div>

      <div className="card">
        <div className="label">network health</div>
        <div className="stat mt-1">{ms(state.healthMs)}</div>
        <div className="mt-3 flex justify-between text-[11px] text-zinc-500">
          <span>processed → confirmed</span>
          <span className={state.stream.connected ? "text-accent" : "text-fail"}>
            {state.stream.connected ? "live" : "offline"}
          </span>
        </div>
      </div>
    </div>
  );
}
