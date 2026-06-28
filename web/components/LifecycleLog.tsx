"use client";

import { recentLifecycles, useStore, type Lifecycle } from "@/lib/store";
import { STAGES } from "@/lib/events";
import { shortSig, sol } from "@/lib/format";

function stageDots(l: Lifecycle) {
  return (
    <span className="flex gap-1">
      {STAGES.map((s) => {
        const reached = Boolean(l.stages[s]);
        const failed = Boolean(l.failure) && !reached;
        return (
          <span
            key={s}
            title={s}
            className={`h-1.5 w-1.5 rounded-full ${reached ? "bg-accent" : failed ? "bg-fail" : "bg-white/10"}`}
          />
        );
      })}
    </span>
  );
}

export function LifecycleLog() {
  const { state } = useStore();
  const rows = recentLifecycles(state).slice(0, 18);

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">lifecycle log</span>
        <span className="text-[11px] text-zinc-500">{rows.length} recent</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-zinc-600">
            <tr className="text-left">
              <th className="pb-2 font-normal">signature</th>
              <th className="pb-2 font-normal">src</th>
              <th className="pb-2 font-normal">stages</th>
              <th className="pb-2 text-right font-normal">tip</th>
              <th className="pb-2 text-right font-normal">status</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((l) => (
              <tr key={l.signature} className="border-t border-white/[0.04]">
                <td className="py-1.5 text-zinc-300">{shortSig(l.signature)}</td>
                <td className="py-1.5 text-zinc-500">{l.source === "submitted" ? "tx" : "obs"}</td>
                <td className="py-1.5">{stageDots(l)}</td>
                <td className="py-1.5 text-right text-zinc-400">{l.tip ? sol(l.tip) : "—"}</td>
                <td className="py-1.5 text-right">
                  {l.failure ? (
                    <span className="text-fail">{l.failure.replace(/_/g, " ")}</span>
                  ) : l.stages.finalized ? (
                    <span className="text-accent">finalized</span>
                  ) : (
                    <span className="text-zinc-500">…</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-zinc-600">
                  waiting for transactions…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
