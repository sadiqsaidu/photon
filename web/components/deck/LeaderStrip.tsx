"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useLeaders } from "./leaders-context";

const CELLS = 28;

function short(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

// Upcoming slots as a rail; the amber block is the next Jito leader window
// sliding toward "now". Green pulse = window open, fire now.
export function LeaderStrip() {
  const { state } = useStore();
  const { leaders, next } = useLeaders();
  const n = state.network;
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);

  const liveSlot = Math.max(state.slot, leaders?.currentSlot ?? 0);
  const w = leaders?.windows.find((x) => x.end >= liveSlot) ?? null;
  const remaining = w ? w.start - liveSlot : null;
  const open = Boolean(next?.open || (remaining !== null && remaining <= 0));
  const windowLen = w ? w.end - w.start + 1 : 4;
  const etaS = remaining !== null && remaining > 0 ? ((remaining * (leaders?.slotMs || 400)) / 1000).toFixed(1) : null;

  return (
    <div className="panel p-4">
      <div className="label mb-3">leader window · jito</div>

      <div className="flex items-baseline gap-3">
        <span className={`hero-num text-[30px] leading-none ${open ? "!text-moss" : ""}`}>
          {remaining === null ? "—" : open ? "OPEN" : remaining}
        </span>
        <span className="text-[11px] text-bone-faint">
          {open ? "fire now" : remaining === null ? "deriving…" : `slots · ~${etaS}s`}
        </span>
      </div>

      {/* slot rail */}
      <div className={`mt-4 flex h-6 items-stretch gap-px ${open ? "window-open" : ""}`}>
        {Array.from({ length: CELLS }, (_, i) => {
          const inWindow = remaining !== null && i >= Math.max(0, remaining) && i < Math.max(0, remaining) + windowLen;
          const isNow = i === 0;
          return (
            <span
              key={i}
              className={`flex-1 transition-colors duration-300 ${
                isNow && open ? "bg-moss" : isNow ? "bg-bone-dim" : inWindow ? "bg-gilt" : "bg-line"
              }`}
              style={{ opacity: inWindow || isNow ? 1 : Math.max(0.25, 1 - i * 0.03) }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-widest text-bone-ghost">
        <span>now</span>
        <span>+{CELLS} slots</span>
      </div>

      <div className="mt-4 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-bone-faint">current leader</span>
          <span className="flex items-center gap-1.5 tabular-nums text-bone-dim">
            {short(n?.leader)}
            {n?.leaderIsJito && <span className="tag-gilt">jito</span>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-bone-faint">targeted window</span>
          <span className="tabular-nums text-bone-dim">{short(w?.identity)}</span>
        </div>
      </div>
    </div>
  );
}
