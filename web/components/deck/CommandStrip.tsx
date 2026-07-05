"use client";

import { useStore, useLive } from "@/lib/store";
import { Odometer } from "./Odometer";
import { WalletButton } from "@/components/WalletButton";

// Top strip: identity, the slot heartbeat, epoch progress as a hairline, vitals.
export function CommandStrip() {
  const { state } = useStore();
  const live = useLive(state.lastEventAt);
  const n = state.network;

  return (
    <header className="relative border-b border-line bg-coal-panel">
      <div className="flex h-12 items-center gap-6 px-5">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-extrabold tracking-tight text-bone">photon</span>
          <span className="tag-ghost">mainnet</span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="label">slot</span>
          <Odometer value={state.slot} className="text-[15px] font-bold text-bone" />
        </div>

        <div className="hidden items-baseline gap-2 md:flex">
          <span className="label">epoch</span>
          <span className="text-[13px] font-semibold tabular-nums text-bone">{n ? n.epoch : "—"}</span>
          <span className="text-[11px] tabular-nums text-bone-faint">
            {n ? `${Math.round(n.epochProgress * 100)}%` : ""}
          </span>
        </div>

        <div className="hidden items-baseline gap-2 md:flex">
          <span className="label">tps</span>
          <span className="text-[13px] font-semibold tabular-nums text-bone">
            {n ? n.tps.toLocaleString() : "—"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span className={`flex items-center gap-1.5 text-[11px] ${live ? "text-moss" : "text-bone-faint"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "live-dot bg-moss" : "bg-bone-ghost"}`} />
            {live ? "live" : "no signal"}
          </span>
          <WalletButton />
        </div>
      </div>
      {/* epoch progress hairline */}
      <div className="absolute bottom-0 left-0 h-px w-full bg-line">
        <div
          className="h-px bg-ember transition-[width] duration-1000 ease-linear"
          style={{ width: `${n ? n.epochProgress * 100 : 0}%` }}
        />
      </div>
    </header>
  );
}
