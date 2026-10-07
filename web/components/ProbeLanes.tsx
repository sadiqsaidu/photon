"use client";

import type { Stage, Stats } from "@/lib/events";
import { beamRecordUrl, lamports, short, solscanTx } from "@/lib/format";

const STAGES: Stage[] = ["submitted", "processed", "confirmed", "finalized"];

export function ProbeLanes({ stats }: { stats: Stats | null }) {
  const receipts = (stats?.receipts ?? []).slice(0, 10);
  const status = (r: (typeof receipts)[number]) => {
    if (r.failure) return <span className="tag bad">{r.failure}</span>;
    if (r.settled || r.landedSlot !== null) return <span className="tag good">landed</span>;
    // Sent before a restart and never seen again: no status to report.
    if (r.sentAt && Date.now() - r.sentAt > 180_000) return <span className="tag">outcome unknown</span>;
    return <span className="tag warn">in flight</span>;
  };
  return (
    <section className="panel">
      <div className="title">
        <span className="label">probe and send lanes, last 10</span>
        <span className="faint" style={{ fontSize: 11 }}>submitted, processed, confirmed, finalized</span>
      </div>
      {receipts.length === 0 && <p className="muted">No probes or SDK sends yet. Probes run when PROBE_SECRET is set.</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {receipts.map((r) => (
          <div key={r.signature} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
              <a href={solscanTx(r.signature)} target="_blank" rel="noreferrer">
                {short(r.signature, 8, 6)}
              </a>
              <span className="tag">{r.kind}</span>
              <span className="muted num">tip {lamports(r.tip)}</span>
              {r.landedSlot !== null && <span className="muted num">+{r.landedSlot - r.sentSlot} slots</span>}
              {status(r)}
              {r.beam && (
                <a href={beamRecordUrl(r.signature)} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11 }}>
                  Beam record: {r.beam.is_landed ? "landed" : "not landed"} {r.beam.region}
                  {r.beam.landed_via_jito ? " via Jito" : ""}
                </a>
              )}
            </div>
            <div className="stages" aria-label="lifecycle stages">
              {STAGES.map((s) => (
                <div key={s} className={`stage ${r.stages[s] ? "on" : r.failure && s !== "submitted" ? "fail" : ""}`} title={r.stages[s] ? `${s} ${r.stages[s]?.ms} ms` : s} />
              ))}
            </div>
            <div className="faint num" style={{ fontSize: 10, display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
              {STAGES.map((s) => (
                <span key={s}>{r.stages[s] ? `${r.stages[s]?.ms} ms` : ""}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
