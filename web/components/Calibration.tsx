"use client";

import { useState } from "react";
import type { Stats } from "@/lib/events";
import { pct } from "@/lib/format";

const S = 220;
const P = 28;

// Reliability diagram: predicted landing probability against the observed rate
// per bucket; points on the diagonal are well calibrated.
export function Calibration({ stats }: { stats: Stats | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const c = stats?.calibration;
  const scale = (v: number) => P + v * (S - 2 * P);
  const flip = (v: number) => S - scale(v);
  const points = (c?.buckets ?? []).map((b, i) => ({ ...b, i })).filter((b) => b.n > 0 && b.predicted !== null && b.actual !== null);
  const reason = stats?.probe.stopReason;

  return (
    <section className="panel">
      <div className="title">
        <span className="label">calibration, landing within {c?.deadlineSlots ?? 2} slots</span>
        {c && <span className={`tag ${c.calibrated ? "good" : "warn"}`}>{c.calibrated ? "calibrated" : "collecting"}</span>}
      </div>
      <div className="cal-grid">
        <div className="chart">
          <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Predicted versus actual landing rate per bucket">
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={scale(0)} x2={scale(1)} y1={flip(t)} y2={flip(t)} stroke="var(--line)" />
                <text x={P - 4} y={flip(t) + 3} fontSize={9} textAnchor="end" fill="var(--text-3)">
                  {t * 100}%
                </text>
                <text x={scale(t)} y={S - 8} fontSize={9} textAnchor="middle" fill="var(--text-3)">
                  {t * 100}%
                </text>
              </g>
            ))}
            <line x1={scale(0)} y1={flip(0)} x2={scale(1)} y2={flip(1)} stroke="var(--line-bright)" />
            {points.map((b) => (
              <circle
                key={b.i}
                cx={scale(b.predicted as number)}
                cy={flip(b.actual as number)}
                r={hover === b.i ? 7 : 5}
                fill="var(--series-p50)"
                stroke="var(--panel)"
                strokeWidth={2}
                onMouseEnter={() => setHover(b.i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`p${b.lo}-${b.hi}: predicted ${pct(b.predicted)}, actual ${pct(b.actual)}, n ${b.n}`}</title>
              </circle>
            ))}
          </svg>
          <div className="faint" style={{ fontSize: 10, textAlign: "center" }}>predicted (x) vs actual (y)</div>
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>bucket</th>
                <th className="r">probes</th>
                <th className="r">predicted</th>
                <th className="r">actual</th>
                <th className="r">model</th>
              </tr>
            </thead>
            <tbody>
              {(c?.buckets ?? []).map((b, i) => (
                <tr key={i} style={{ background: hover === i ? "var(--raise)" : undefined }}>
                  <td>
                    p{b.lo}-{b.hi}
                  </td>
                  <td className="r">{b.n}</td>
                  <td className="r">{pct(b.predicted)}</td>
                  <td className="r">{pct(b.actual)}</td>
                  <td className="r">{pct(b.model)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: "10px 0 0" }}>
            Brier score <b className="num">{c?.brier === null || c?.brier === undefined ? "-" : c.brier.toFixed(3)}</b>{" "}
            <span className="muted">over {c?.probes ?? 0} probes (0 is perfect, 0.25 is a coin flip)</span>
          </p>
          {reason && <p className="faint" style={{ margin: "6px 0 0", fontSize: 11 }}>Probes stopped: {reason}.</p>}
        </div>
      </div>
    </section>
  );
}
