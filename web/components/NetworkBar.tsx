"use client";

import { useStore } from "@/lib/store";

export function NetworkBar() {
  const { state } = useStore();
  const n = state.network;
  const pct = n ? Math.round(n.epochProgress * 100) : 0;

  return (
    <div className="border-b border-white/[0.06] bg-ink-900/40 px-5 py-2.5">
      <div className="flex items-center gap-4 text-[11px] text-zinc-500">
        <span>
          epoch <span className="num text-zinc-300">{n?.epoch ?? "—"}</span>
        </span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent/60" style={{ width: `${pct}%` }} />
        </div>
        <span className="num text-zinc-400">{pct}%</span>
        <span className="hidden sm:inline">
          tps <span className="num text-zinc-300">{n ? n.tps.toLocaleString() : "—"}</span>
        </span>
      </div>
    </div>
  );
}
