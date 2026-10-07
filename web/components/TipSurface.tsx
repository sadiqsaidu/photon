"use client";

import { useMemo, useState } from "react";
import type { Stats } from "@/lib/events";
import { compact, lamports } from "@/lib/format";

const W = 960;
const H = 280;
const HEAT_H = 84;
const M = { left: 48, right: 64, top: 10, bottom: 20 };
const FORECAST = 10;
const BEAM_FLOOR = 100_000;

function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

export function TipSurface({ stats }: { stats: Stats | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = stats?.tips.window ?? [];
  const tipped = rows.filter((r) => r.count > 0);
  const forecast = stats?.tips.forecast ?? [];
  const lag = stats?.tips.lag;

  const geo = useMemo(() => {
    if (!tipped.length) return null;
    const first = (rows[0] as { slot: number }).slot;
    const last = stats?.tips.lastConfirmed ?? first;
    const span = Math.max(1, last + FORECAST - first);
    const x = (slot: number) => M.left + ((slot - first) / span) * (W - M.left - M.right);
    const values = tipped.flatMap((r) => [r.p50, r.p90, ...r.dots]).concat(forecast.flatMap((f) => [f.p50, f.p90]), BEAM_FLOOR).filter((v) => v > 0);
    const lo = Math.max(1, 10 ** Math.floor(Math.log10(Math.min(...values))));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(...values)));
    const y = (v: number) => M.top + (1 - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (H - M.top - M.bottom);
    const ticks: number[] = [];
    for (let t = lo; t <= hi; t *= 10) ticks.push(t);
    const maxHeat = Math.max(1, ...rows.map((r) => r.heat));
    const hy = (v: number) => 8 + (1 - v / maxHeat) * (HEAT_H - 20);
    return { first, last, x, y, ticks, maxHeat, hy };
  }, [rows, tipped, forecast, stats?.tips.lastConfirmed]);

  if (!geo) {
    return (
      <section className="panel">
        <div className="label">tip surface</div>
        <p className="muted">Waiting for confirmed slots from the gRPC stream...</p>
      </section>
    );
  }

  const { x, y, hy, last } = geo;
  const p50 = tipped.map((r) => [x(r.slot), y(r.p50)] as [number, number]);
  const p90 = tipped.map((r) => [x(r.slot), y(r.p90)] as [number, number]);
  const lastRow = tipped[tipped.length - 1] as (typeof tipped)[number];
  const f50 = [[x(lastRow.slot), y(lastRow.p50)] as [number, number], ...forecast.map((f) => [x(last + f.h), y(f.p50)] as [number, number])];
  const f90 = [[x(lastRow.slot), y(lastRow.p90)] as [number, number], ...forecast.map((f) => [x(last + f.h), y(f.p90)] as [number, number])];
  const heatPts = rows.map((r) => [x(r.slot), hy(r.heat)] as [number, number]);
  const heatArea = heatPts.length
    ? `${linePath(heatPts)}L${(heatPts[heatPts.length - 1] as [number, number])[0]},${HEAT_H - 12}L${(heatPts[0] as [number, number])[0]},${HEAT_H - 12}Z`
    : "";
  const hovered = hover === null ? null : rows.find((r) => r.slot === hover) ?? null;
  const end50 = p50[p50.length - 1] as [number, number];
  const end90 = p90[p90.length - 1] as [number, number];

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best: number | null = null;
    for (const r of rows) if (best === null || Math.abs(x(r.slot) - px) < Math.abs(x(best) - px)) best = r.slot;
    setHover(best);
  };

  const tooltipLeft = hovered ? `${(x(hovered.slot) / W) * 100}%` : "0";

  return (
    <section className="panel">
      <div className="title">
        <span className="label">tip surface, landed tips per slot (lamports, log scale)</span>
        <span className="muted" style={{ fontSize: 11 }}>
          <span className="swatch" style={{ background: "var(--series-p90)" }} />p90
          <span className="swatch" style={{ background: "var(--series-p50)", marginLeft: 12 }} />p50
          <span className="swatch" style={{ background: "var(--series-dot)", height: 6, width: 6, borderRadius: 3, marginLeft: 12 }} />landed tips
          <span className="swatch" style={{ borderTop: "2px dashed var(--text-2)", height: 0, marginLeft: 12 }} />forecast +{FORECAST} slots
          <span className="swatch" style={{ background: "var(--series-heat)", marginLeft: 12 }} />Blur heat
        </span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Per-slot tip p50 and p90 with forecast">
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={M.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-3)">
                {compact(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={W - M.right} y1={y(BEAM_FLOOR)} y2={y(BEAM_FLOOR)} stroke="var(--text-2)" strokeWidth={1} />
          <rect x={M.left + 2} y={y(BEAM_FLOOR) - 15} width={92} height={13} fill="var(--panel)" opacity={0.85} />
          <text x={M.left + 6} y={y(BEAM_FLOOR) - 5} fontSize={10} fill="var(--text-2)">
            Beam floor 100k
          </text>
          <line x1={x(last)} x2={x(last)} y1={M.top} y2={H - M.bottom} stroke="var(--line-bright)" strokeWidth={1} />
          <text x={x(last) - 4} y={H - M.bottom + 14} fontSize={10} textAnchor="end" fill="var(--text-3)">
            now
          </text>
          {tipped.map((r) =>
            r.dots.map((d, i) => <circle key={`${r.slot}-${i}`} cx={x(r.slot)} cy={y(d)} r={1.6} fill="var(--series-dot)" opacity={0.35} />),
          )}
          <path d={linePath(p90)} fill="none" stroke="var(--series-p90)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={linePath(p50)} fill="none" stroke="var(--series-p50)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={linePath(f90)} fill="none" stroke="var(--series-p90)" strokeWidth={2} strokeDasharray="4 4" />
          <path d={linePath(f50)} fill="none" stroke="var(--series-p50)" strokeWidth={2} strokeDasharray="4 4" />
          <text x={W - M.right + 6} y={y((forecast.at(-1)?.p90 ?? lastRow.p90)) + 3} fontSize={10} fill="var(--text-2)">
            p90
          </text>
          <text x={W - M.right + 6} y={y((forecast.at(-1)?.p50 ?? lastRow.p50)) + 3} fontSize={10} fill="var(--text-2)">
            p50
          </text>
          <circle cx={end90[0]} cy={end90[1]} r={4} fill="var(--series-p90)" stroke="var(--panel)" strokeWidth={2} />
          <circle cx={end50[0]} cy={end50[1]} r={4} fill="var(--series-p50)" stroke="var(--panel)" strokeWidth={2} />
          {hovered && <line x1={x(hovered.slot)} x2={x(hovered.slot)} y1={M.top} y2={H - M.bottom} stroke="var(--text-3)" strokeWidth={1} />}
          <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {hovered && (
          <div className="tooltip" style={{ left: tooltipLeft, top: 8, transform: x(hovered.slot) > W * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}>
            <div>slot {hovered.slot.toLocaleString("en-US")}</div>
            <div className="muted">{hovered.count} landed tips</div>
            <div>
              <span className="swatch" style={{ background: "var(--series-p90)" }} />p90 {lamports(hovered.p90)}
            </div>
            <div>
              <span className="swatch" style={{ background: "var(--series-p50)" }} />p50 {lamports(hovered.p50)}
            </div>
            <div>
              <span className="swatch" style={{ background: "var(--series-heat)" }} />heat {Math.round(hovered.heat)}
            </div>
          </div>
        )}
      </div>
      <div className="chart" style={{ marginTop: 4 }}>
        <svg viewBox={`0 0 ${W} ${HEAT_H}`} role="img" aria-label="Blur market heat per slot">
          <line x1={M.left} x2={W - M.right} y1={HEAT_H - 12} y2={HEAT_H - 12} stroke="var(--line)" strokeWidth={1} />
          <path d={heatArea} fill="var(--series-heat)" opacity={0.12} />
          <path d={linePath(heatPts)} fill="none" stroke="var(--series-heat)" strokeWidth={2} strokeLinejoin="round" />
          <text x={M.left - 6} y={14} textAnchor="end" fontSize={10} fill="var(--text-3)">
            {compact(geo.maxHeat)}
          </text>
          <text x={W - M.right + 6} y={HEAT_H - 14} fontSize={10} fill="var(--text-2)">
            heat
          </text>
          {hovered && <line x1={x(hovered.slot)} x2={x(hovered.slot)} y1={4} y2={HEAT_H - 12} stroke="var(--text-3)" strokeWidth={1} />}
        </svg>
      </div>
      <p style={{ margin: "8px 0 0" }}>
        {lag && lag.n > 0 ? (
          lag.qualifies ? (
            <>
              Heat leads tips by <b>{lag.k} slots</b> (r = {lag.r.toFixed(2)}, n = {lag.n}); the forecast applies the heat multiplier.
            </>
          ) : (
            <>
              No lead detected in the last 900 slots <span className="muted">(best r = {lag.r.toFixed(2)} at k = {lag.k}, n = {lag.n}; needs r at least 0.20 and k at least 1)</span>
            </>
          )
        ) : (
          <span className="muted">Lag test runs every 30 s once slots accumulate.</span>
        )}
      </p>
    </section>
  );
}
