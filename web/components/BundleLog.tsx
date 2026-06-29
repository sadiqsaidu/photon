"use client";

import { bundleCounts, useStore, yourBundles, type Lifecycle } from "@/lib/store";
import { STAGES } from "@/lib/events";
import { shortSig, sol } from "@/lib/format";

function stageDots(l: Lifecycle) {
  return (
    <span className="flex gap-1">
      {STAGES.map((s) => {
        const reached = Boolean(l.stages[s]);
        const failed = Boolean(l.failure) && !reached;
        return <span key={s} title={s} className={`h-1.5 w-1.5 rounded-full ${reached ? "bg-accent" : failed ? "bg-fail" : "bg-white/10"}`} />;
      })}
    </span>
  );
}

export function BundleLog() {
  const { state } = useStore();
  const rows = yourBundles(state).slice(0, 12);
  const c = bundleCounts(state);

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">your bundles</span>
        <span className="num text-[11px]">
          <span className="text-accent">{c.landed} landed</span> · <span className="text-zinc-400">{c.inFlight} live</span> ·{" "}
          <span className="text-fail">{c.failed} failed</span>
        </span>
      </div>

      <table className="w-full text-[12px]">
        <thead className="text-[10px] uppercase tracking-wider text-zinc-600">
          <tr className="text-left">
            <th className="pb-2 font-medium">signature</th>
            <th className="pb-2 font-medium">stages</th>
            <th className="pb-2 text-right font-medium">tip</th>
            <th className="pb-2 text-right font-medium">status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.signature} className="border-t border-white/[0.04]">
              <td className="num py-1.5 text-zinc-300">{shortSig(l.signature)}</td>
              <td className="py-1.5">{stageDots(l)}</td>
              <td className="num py-1.5 text-right text-zinc-400">{l.tip ? sol(l.tip) : "—"}</td>
              <td className="py-1.5 text-right">
                {l.failure ? (
                  <span className="text-fail">{l.failure.replace(/_/g, " ")}</span>
                ) : l.stages.finalized ? (
                  <span className="text-accent">finalized</span>
                ) : (
                  <span className="num text-zinc-500">…</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-5 text-center text-[12px] text-zinc-600">
                no bundles yet — build one above
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
