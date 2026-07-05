"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { sol } from "@/lib/format";
import type { PhotonEvent } from "@/lib/events";

interface FloorPoint {
  t: number;
  v: number;
}

interface PolicyNode {
  t: number;
  tip: number;
  anchor: string;
  multiplier: number;
  reasoning: string;
  confidence: number;
  trendPct: number;
  p50AtLanding: number;
}

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes of history
const NOW_X = 0.8; // "now" sits at 80% width; the right 20% is the forecast
const EMBER = "#e5484d";
const GILT = "#d9a53a";

interface Hover {
  x: number;
  y: number;
  node: PolicyNode;
}

// The tip surface: live tip floor (crimson), the agent's tip (amber steps),
// and the Holt forecast projected past "now". The AI is not in a side panel —
// every policy decision is a node pinned to the exact moment it was made.
export function TipSurface() {
  const { state, subscribe } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const floors = useRef<FloorPoint[]>([]);
  const policies = useRef<PolicyNode[]>([]);
  const nodesPx = useRef<{ x: number; y: number; node: PolicyNode }[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);
  const [pinned, setPinned] = useState<Hover | null>(null);

  useEffect(() => {
    const unsub = subscribe((ev: PhotonEvent) => {
      const now = Date.now();
      if (ev.type === "network" && ev.tipFloor > 0) {
        floors.current.push({ t: now, v: ev.tipFloor });
        if (floors.current.length > 600) floors.current.shift();
      }
      if (ev.type === "tip_policy") {
        policies.current.push({
          t: now,
          tip: ev.tip,
          anchor: ev.anchor,
          multiplier: ev.multiplier,
          reasoning: ev.reasoning,
          confidence: ev.confidence,
          trendPct: ev.forecast.trendPctPer10Slots,
          p50AtLanding: ev.forecast.p50AtLanding,
        });
        if (policies.current.length > 120) policies.current.shift();
      }
    });
    return () => {
      unsub();
    };
  }, [subscribe]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(wrap);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (w === 0 || h === 0) return;
      const now = Date.now();
      // adaptive span: young sessions fill the plot instead of hugging "now"
      const oldest = floors.current[0]?.t ?? now - 60_000;
      const span = Math.max(60_000, Math.min(WINDOW_MS, now - oldest));
      const t0 = now - span;
      const fs = floors.current.filter((p) => p.t >= t0);
      const ps = policies.current.filter((p) => p.t >= t0);
      ctx.clearRect(0, 0, w, h);

      const pad = 14;
      const plotW = w * NOW_X;
      const X = (t: number) => ((t - t0) / span) * plotW;
      // log scale over everything visible (tips span orders of magnitude)
      const values = [...fs.map((f) => f.v), ...ps.map((p) => p.tip)].filter((v) => v > 0);
      if (values.length === 0) {
        nodesPx.current = [];
        return;
      }
      const lo = Math.log10(Math.min(...values)) - 0.15;
      const hi = Math.log10(Math.max(...values)) + 0.15;
      const Y = (v: number) => {
        const f = hi === lo ? 0.5 : (Math.log10(Math.max(v, 1)) - lo) / (hi - lo);
        return h - pad - f * (h - pad * 2);
      };

      // hairline grid
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // floor: crimson area
      if (fs.length > 1) {
        ctx.beginPath();
        fs.forEach((p, i) => {
          const x = X(p.t);
          const y = Y(p.v);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = EMBER;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        const last = fs[fs.length - 1]!;
        const first = fs[0]!;
        ctx.lineTo(X(last.t), h);
        ctx.lineTo(X(first.t), h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgba(229,72,77,0.28)");
        grad.addColorStop(1, "rgba(229,72,77,0.02)");
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // agent tip: amber steps
      if (ps.length > 0) {
        ctx.beginPath();
        ps.forEach((p, i) => {
          const x = X(p.t);
          const y = Y(p.tip);
          if (i === 0) ctx.moveTo(x, y);
          else {
            ctx.lineTo(x, Y(ps[i - 1]!.tip));
            ctx.lineTo(x, y);
          }
        });
        const lastP = ps[ps.length - 1]!;
        ctx.lineTo(plotW, Y(lastP.tip));
        ctx.strokeStyle = GILT;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // now line
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(plotW, 0);
      ctx.lineTo(plotW, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // forecast projection: dashed amber curve into the right margin
      const lastP = ps[ps.length - 1];
      if (lastP) {
        const horizonSlots = 150; // ~60s ahead
        const perSlot = Math.pow(1 + lastP.trendPct / 100, 1 / 10);
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(217,165,58,0.65)";
        for (let s = 0; s <= horizonSlots; s += 5) {
          const x = plotW + (s / horizonSlots) * (w - plotW - 6);
          const v = lastP.p50AtLanding * Math.pow(perSlot, s);
          const y = Y(Math.max(1, v));
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // AI decision nodes: amber diamonds on the tip line
      nodesPx.current = ps.map((p) => {
        const x = X(p.t);
        const y = Y(p.tip);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        const r = 3.5;
        ctx.fillStyle = GILT;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
        // stem to the ground: makes the decision feel pinned to the moment
        ctx.strokeStyle = "rgba(217,165,58,0.18)";
        ctx.beginPath();
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x, h);
        ctx.stroke();
        return { x, y, node: p };
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  function onMove(e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: Hover | null = null;
    let bestD = 14;
    for (const n of nodesPx.current) {
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d < bestD) {
        bestD = d;
        best = { x: n.x, y: n.y, node: n.node };
      }
    }
    setHover(best);
  }

  const active = pinned ?? hover;
  const empty = floors.current.length === 0 && !state.network;

  return (
    <div className="panel relative">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="label">tip surface · live floor vs the mind</span>
        <div className="flex items-center gap-3 text-[10px] text-bone-faint">
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 bg-ember" /> floor p50
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 bg-gilt" /> ai tip
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 border-t border-dashed border-gilt/70" /> forecast
          </span>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="scanlines relative h-[280px] cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => setPinned(pinned ? null : hover)}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        <span className="absolute right-2 top-1 text-[9px] uppercase tracking-widest text-bone-ghost">
          forecast →
        </span>
        {empty && (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-bone-ghost">
            awaiting stream…
          </span>
        )}
        {active && (
          <div
            className="rise-in pointer-events-none absolute z-10 w-64 border border-gilt-dim bg-coal p-3"
            style={{
              left: Math.min(Math.max(active.x - 128, 8), (wrapRef.current?.clientWidth ?? 400) - 270),
              top: Math.max(active.y - 8, 8) > 150 ? active.y - 148 : active.y + 14,
            }}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gilt">the mind</span>
              <span className="text-[10px] tabular-nums text-bone-faint">
                {active.node.anchor}×{active.node.multiplier} → {sol(active.node.tip)}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-bone-dim">{active.node.reasoning || "no reasoning recorded"}</p>
            <div className="mt-2 h-0.5 w-full bg-line">
              <div className="h-0.5 bg-gilt" style={{ width: `${active.node.confidence * 100}%` }} />
            </div>
            <div className="mt-1 text-[9px] text-bone-faint">confidence {(active.node.confidence * 100).toFixed(0)}%</div>
          </div>
        )}
      </div>
    </div>
  );
}
