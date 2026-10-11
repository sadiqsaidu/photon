"use client";

import { useEffect, useRef, useState } from "react";
import { lamportsToUsd, SLOT_MS, usd } from "@/lib/format";
import { getState, getWindow, useLive } from "@/lib/live";
import { useReducedMotion } from "@/lib/motion";
import type { WindowRow } from "@/lib/types";
import s from "./SlotRiver.module.css";

const BEAM_MIN = 100_000;
const FORECAST_SLOTS = 10;
const SMOOTH = 4;
const INK = "21, 24, 29";

interface Hover {
  x: number;
  y: number;
  row: WindowRow;
}

function smooth(rows: WindowRow[], key: "p25" | "p50" | "p75"): (number | null)[] {
  return rows.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = i - SMOOTH; k <= i + SMOOTH; k++) {
      const r = rows[k];
      if (r && r.count > 0 && r[key] > 0) {
        sum += Math.log(r[key]);
        n++;
      }
    }
    return n ? Math.exp(sum / n) : null;
  });
}

function hash(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function decadeLabel(lamports: number, price: number | null): string {
  const d = lamportsToUsd(lamports, price);
  if (d === null) return `${lamports / 1e9} SOL`;
  const p = Number(d.toPrecision(1));
  return p >= 0.01 ? `$${p.toFixed(2)}` : `$${p}`;
}

export function SlotRiver() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const ready = useLive((st) => st.ready);
  const price = useLive((st) => st.solPrice);
  const priceRef = useRef(price);
  priceRef.current = price;
  const [hover, setHover] = useState<Hover | null>(null);
  const geometry = useRef({ nowX: 0, pxPerSlot: 1, head: 0, rows: [] as WindowRow[] });
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    const wrap = box.current;
    if (!el || !wrap) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, raf = 0;
    let domain = { lo: 3, hi: 7, at: 0 };
    const font = getComputedStyle(el).fontFamily;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setNarrow(w < 640);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const draw = () => {
      const st = getState();
      const all = getWindow();
      const n = w < 640 ? 150 : 600;
      const rows = all.slice(-n) as WindowRow[];
      ctx.clearRect(0, 0, w, h);
      if (!rows.length) return;
      const latest = Math.max(st.slot, (rows.at(-1) as WindowRow).slot);
      const frac = reduced ? 0 : Math.min(1.2, (performance.now() - st.lastSlotAt) / SLOT_MS);
      const head = latest + frac;
      const right = w < 640 ? 52 : 64;
      const plotW = w - right;
      const nowX = plotW - Math.min(140, plotW * 0.14);
      const pxPerSlot = nowX / n;
      const top = w < 640 ? 40 : 30, bottom = h - 26;
      geometry.current = { nowX, pxPerSlot, head, rows };

      if (performance.now() - domain.at > 2_000) {
        const vals: number[] = [];
        for (const r of rows) for (const v of r.dots) if (v > 0) vals.push(v);
        vals.sort((a, b) => a - b);
        if (vals.length > 20) {
          const lo = Math.floor(Math.log10(vals[Math.floor(vals.length * 0.03)] as number));
          const hi = Math.ceil(Math.log10(Math.max(BEAM_MIN * 10, vals[Math.floor(vals.length * 0.995)] as number)));
          domain = { lo: Math.min(lo, 4), hi: Math.max(hi, lo + 3), at: performance.now() };
        }
      }
      const y = (v: number) => bottom - ((Math.log10(Math.max(v, 1)) - domain.lo) / (domain.hi - domain.lo)) * (bottom - top);
      const x = (slot: number) => nowX - (head - slot) * pxPerSlot;

      ctx.font = `500 12px ${font}`;
      ctx.textBaseline = "alphabetic";
      for (let d = domain.lo; d <= domain.hi; d++) {
        const yy = Math.round(y(10 ** d)) + 0.5;
        ctx.strokeStyle = "rgba(21, 24, 29, 0.10)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(plotW, yy);
        ctx.stroke();
        ctx.fillStyle = "#4b515b";
        ctx.fillText(decadeLabel(10 ** d, priceRef.current), plotW + 8, yy + 4);
      }

      const dot = Math.max(1.4, Math.min(2.2, pxPerSlot * 0.9));
      ctx.fillStyle = `rgba(${INK}, 0.30)`;
      for (const r of rows) {
        const xs = x(r.slot);
        if (xs < -4) continue;
        r.dots.forEach((v, i) => {
          if (v <= 0) return;
          ctx.fillRect(xs + (hash(r.slot, i) - 0.5) * pxPerSlot * 1.6, y(v) - dot / 2, dot, dot);
        });
      }
      ctx.fillStyle = "#d98e00";
      for (const r of rows) for (const v of r.beam) ctx.fillRect(x(r.slot) - 1.75, y(v) - 1.75, 3.5, 3.5);

      const p25 = smooth(rows, "p25"), p50 = smooth(rows, "p50"), p75 = smooth(rows, "p75");
      ctx.save();
      ctx.shadowColor = "rgba(255, 178, 26, 0.55)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "rgba(255, 178, 26, 0.42)";
      let open = false;
      const segment: number[] = [];
      const flush = () => {
        if (segment.length < 2) return void (segment.length = 0);
        ctx.beginPath();
        segment.forEach((i, k) => (k ? ctx.lineTo(x(rows[i]!.slot), y(p75[i]!)) : ctx.moveTo(x(rows[i]!.slot), y(p75[i]!))));
        for (let k = segment.length - 1; k >= 0; k--) ctx.lineTo(x(rows[segment[k]!]!.slot), y(p25[segment[k]!]!));
        ctx.closePath();
        ctx.fill();
        segment.length = 0;
      };
      rows.forEach((_, i) => {
        if (p25[i] != null && p75[i] != null) {
          segment.push(i);
          open = true;
        } else if (open) {
          flush();
          open = false;
        }
      });
      flush();
      ctx.restore();

      ctx.strokeStyle = `rgba(${INK}, 0.9)`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let pen = false;
      rows.forEach((r, i) => {
        const v = p50[i];
        if (v == null) return void (pen = false);
        if (pen) ctx.lineTo(x(r.slot), y(v));
        else ctx.moveTo(x(r.slot), y(v));
        pen = true;
      });
      ctx.stroke();

      let last = rows.length - 1;
      while (last > 0 && (p25[last] == null || p75[last] == null)) last--;
      const l25 = p25[last], l75 = p75[last], l50 = p50[last];
      if (l25 != null && l75 != null) {
        const fw = plotW - nowX;
        const g = ctx.createLinearGradient(nowX, 0, plotW, 0);
        g.addColorStop(0, "rgba(255, 178, 26, 0.42)");
        g.addColorStop(1, "rgba(255, 178, 26, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(nowX, y(l75), fw, y(l25) - y(l75));
        if (l50 != null) {
          const gl = ctx.createLinearGradient(nowX, 0, plotW, 0);
          gl.addColorStop(0, `rgba(${INK}, 0.6)`);
          gl.addColorStop(1, `rgba(${INK}, 0)`);
          ctx.strokeStyle = gl;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(nowX, y(l50));
          ctx.lineTo(plotW, y(l50));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = "#15181d";
        ctx.font = `600 12px ${font}`;
        const gx = Math.max(8, nowX - 74);
        ctx.fillText("going rate", gx, Math.max(top + 10, y(l75) - 8));
      }

      const by = Math.round(y(BEAM_MIN)) + 0.5;
      ctx.strokeStyle = "#15181d";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, by);
      ctx.lineTo(plotW, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#15181d";
      ctx.font = `600 12px ${font}`;
      ctx.fillText("Beam minimum", 4, by - 6);

      ctx.strokeStyle = "#15181d";
      ctx.beginPath();
      ctx.moveTo(Math.round(nowX) + 0.5, 4);
      ctx.lineTo(Math.round(nowX) + 0.5, bottom + 6);
      ctx.stroke();
      ctx.fillText("now", nowX + 6, 14);
      ctx.fillStyle = "#4b515b";
      ctx.font = `500 12px ${font}`;
      if (w >= 640) ctx.fillText(`next ${FORECAST_SLOTS} blocks`, nowX + 6, 28);

      const span = (n * SLOT_MS) / 1000;
      const ago = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)} minute${sec >= 90 ? "s" : ""} ago` : `${Math.round(sec)} seconds ago`);
      ctx.fillText(ago(span), 0, h - 6);
      ctx.fillText(ago(span / 2), nowX / 2 - 30, h - 6);
    };

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced]);

  const onMove = (e: React.PointerEvent) => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const g = geometry.current;
    if (mx > g.nowX || !g.rows.length) return setHover(null);
    const slot = Math.round(g.head - (g.nowX - mx) / g.pxPerSlot);
    const row = g.rows.find((r) => r.slot === slot) ?? null;
    setHover(row ? { x: mx, y: e.clientY - rect.top, row } : null);
  };

  return (
    <figure className={s.figure}>
      <div ref={box} className={`${s.box} ${ready ? s.ready : ""}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <canvas ref={canvas} className={s.canvas} role="img" aria-label={`Every tip that landed in the last ${narrow ? 150 : 600} blocks, with the going rate as a band`} />
        {hover && (
          <div className={s.tip} style={{ left: Math.min(hover.x + 14, (box.current?.clientWidth ?? 0) - 200), top: Math.max(0, hover.y - 70) }} role="status">
            <strong>Block {hover.row.slot.toLocaleString("en-US")}</strong>
            <span>{hover.row.count} {hover.row.count === 1 ? "tip" : "tips"}</span>
            <span>Going rate {hover.row.count ? usd(lamportsToUsd(hover.row.p50, price)) || `${hover.row.p50.toLocaleString("en-US")} lamports` : "none"}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
