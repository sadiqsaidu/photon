"use client";

import { useStore } from "@/lib/store";
import { ms, shortSig, sol } from "@/lib/format";

function Leader({ label, pk, jito }: { label: string; pk: string | null; jito: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="flex items-center gap-2">
        <span className="num text-[12px] text-zinc-300">{pk ? shortSig(pk) : "—"}</span>
        {pk && jito && <span className="badge-jito">JITO</span>}
      </span>
    </div>
  );
}

export function StatusGrid() {
  const { state } = useStore();
  const n = state.network;
  const tip = state.tipPolicy;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="card">
        <div className="label">network</div>
        <div className="num mt-1 text-3xl text-accent">{(n?.slot ?? state.slot).toLocaleString()}</div>
        <div className="mt-4 space-y-2">
          <Leader label="current leader" pk={n?.leader ?? null} jito={Boolean(n?.leaderIsJito)} />
          <Leader label="next leader" pk={n?.nextLeader ?? null} jito={Boolean(n?.nextIsJito)} />
        </div>
      </div>

      <div className="card">
        <div className="label">throughput &amp; health</div>
        <div className="num mt-1 text-3xl text-zinc-100">{n ? n.tps.toLocaleString() : "—"}</div>
        <div className="mt-4 space-y-2 text-[11px] text-zinc-500">
          <div className="flex justify-between">
            <span>tps</span>
            <span className="num text-zinc-300">transactions/s</span>
          </div>
          <div className="flex justify-between">
            <span>processed → confirmed</span>
            <span className="num text-accent">{ms(state.healthMs)}</span>
          </div>
          <div className="flex justify-between">
            <span>tip floor (p50)</span>
            <span className="num text-zinc-300">{n ? `${sol(n.tipFloor)} SOL` : "—"}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="label">tip intelligence · ai</div>
        <div className="num mt-1 text-3xl text-accent">{tip ? sol(tip.tip) : "—"}</div>
        <div className="mt-4 space-y-2 text-[11px] text-zinc-500">
          <div className="flex justify-between">
            <span>policy</span>
            <span className="num text-zinc-300">{tip ? `${tip.anchor} × ${tip.multiplier}` : "awaiting agent"}</span>
          </div>
          <p className="line-clamp-3 leading-relaxed text-zinc-500">{tip?.reasoning ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
