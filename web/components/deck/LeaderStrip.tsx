"use client";

import { useStore } from "@/lib/store";

const CELLS = 28;
const WINDOW = 4;

function short(id: string | null): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

// Upcoming slots as a rail; the amber block is the next Jito leader window
// sliding toward "now". Green pulse = window open, fire now.
export function LeaderStrip() {
  const { state } = useStore();
  const n = state.network;

  // freshest anchor for the countdown: leader transition or last policy tick
  const anchors = [
    state.leader ? { s: state.leader.slotsToLeader, at: state.leader.atSlot } : null,
    state.tipPolicy ? { s: state.tipPolicy.slotsToLeader, at: state.tipPolicy.atSlot } : null,
  ].filter((a): a is { s: number; at: number } => a !== null && a.s >= 0);
  const anchor = anchors.sort((a, b) => b.at - a.at)[0] ?? null;
  const raw = anchor ? anchor.s - (state.slot - anchor.at) : null;
  // window fully passed and no fresh anchor yet -> unknown, not a negative count
  const stale = raw === null || raw <= -WINDOW;
  const open = !stale && raw !== null && raw <= 0;
  const remaining = stale ? null : raw;

  return (
    <div className="panel p-4">
      <div className="label mb-3">leader window · jito</div>

      <div className="flex items-baseline gap-3">
        <span className={`hero-num text-[30px] leading-none ${open ? "!text-moss" : ""}`}>
          {remaining === null ? "—" : open ? "OPEN" : remaining}
        </span>
        <span className="text-[11px] text-bone-faint">
          {open ? "fire now" : remaining === null ? "awaiting anchor" : "slots to leader"}
        </span>
      </div>

      {/* slot rail */}
      <div className={`mt-4 flex h-6 items-stretch gap-px ${open ? "window-open" : ""}`}>
        {Array.from({ length: CELLS }, (_, i) => {
          const inWindow =
            remaining !== null && i >= Math.max(0, remaining) && i < Math.max(0, remaining) + WINDOW;
          const isNow = i === 0;
          return (
            <span
              key={i}
              className={`flex-1 transition-colors duration-300 ${
                isNow && open
                  ? "bg-moss"
                  : isNow
                    ? "bg-bone-dim"
                    : inWindow
                      ? "bg-gilt"
                      : "bg-line"
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
            {short(n?.leader ?? null)}
            {n?.leaderIsJito && <span className="tag-gilt">jito</span>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-bone-faint">next leader</span>
          <span className="flex items-center gap-1.5 tabular-nums text-bone-dim">
            {short(n?.nextLeader ?? null)}
            {n?.nextIsJito && <span className="tag-gilt">jito</span>}
          </span>
        </div>
        {state.leader?.leaderIdentity && (
          <div className="flex items-center justify-between">
            <span className="text-bone-faint">targeted</span>
            <span className="tabular-nums text-bone-dim">{short(state.leader.leaderIdentity)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
