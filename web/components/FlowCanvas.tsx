"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { FAILURES, STAGES } from "@/lib/events";

const ACCENT = "#7fdfff";
const FAILCLR = "#c2616b";
const DIM = "rgba(255,255,255,0.10)";

interface Particle {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  fail: boolean;
}

export function FlowCanvas() {
  const { subscribe } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const lastStage = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const cv = canvas;
    const cx = context;

    let width = 0;
    let height = 0;
    const dpr = window.devicePixelRatio || 1;

    function resize() {
      const rect = cv.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      cv.width = width * dpr;
      cv.height = height * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const stageX = () => STAGES.map((_, i) => width * (0.08 + (i * 0.84) / (STAGES.length - 1)));
    const laneY = () => height * 0.42;
    const failY = () => height * 0.84;
    const failX = () => FAILURES.map((_, i) => width * (0.16 + (i * 0.68) / (FAILURES.length - 1)));

    const off = subscribe((ev) => {
      if (ev.type !== "lifecycle") return;
      const xs = stageX();
      const y = laneY();
      const reached = STAGES.reduce((acc, s, i) => (ev.stages[s] ? i : acc), -1);
      const prev = lastStage.current.get(ev.signature) ?? -1;

      if (ev.failure) {
        const fi = Math.max(0, FAILURES.indexOf(ev.failure));
        const start = Math.max(0, reached);
        particles.current.push({ fromX: xs[start], fromY: y, toX: failX()[fi], toY: failY(), t: 0, fail: true });
      } else if (reached > prev && reached > 0) {
        particles.current.push({ fromX: xs[reached - 1], fromY: y, toX: xs[reached], toY: y, t: 0, fail: false });
      }
      lastStage.current.set(ev.signature, reached);
      if (lastStage.current.size > 400) lastStage.current.clear();
    });

    let raf = 0;
    function frame() {
      cx.clearRect(0, 0, width, height);
      const xs = stageX();
      const y = laneY();
      const fxs = failX();
      const fy = failY();

      cx.strokeStyle = DIM;
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(xs[0], y);
      cx.lineTo(xs[xs.length - 1], y);
      cx.stroke();

      cx.font = "11px ui-monospace, monospace";
      cx.textAlign = "center";
      STAGES.forEach((s, i) => {
        cx.fillStyle = "rgba(255,255,255,0.18)";
        cx.beginPath();
        cx.arc(xs[i], y, 4, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle = "rgba(255,255,255,0.45)";
        cx.fillText(s, xs[i], y - 16);
      });

      FAILURES.forEach((f, i) => {
        cx.fillStyle = "rgba(194,97,107,0.35)";
        cx.beginPath();
        cx.arc(fxs[i], fy, 3, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle = "rgba(194,97,107,0.55)";
        cx.fillText(f.replace(/_/g, " "), fxs[i], fy + 16);
      });

      const next: Particle[] = [];
      for (const p of particles.current) {
        p.t += 0.02;
        if (p.t >= 1) continue;
        const x = p.fromX + (p.toX - p.fromX) * p.t;
        const cyp = p.fromY + (p.toY - p.fromY) * p.t;
        cx.fillStyle = p.fail ? FAILCLR : ACCENT;
        cx.globalAlpha = 0.85 * (1 - p.t * 0.3);
        cx.beginPath();
        cx.arc(x, cyp, p.fail ? 2.2 : 2.6, 0, Math.PI * 2);
        cx.fill();
        cx.globalAlpha = 1;
        next.push(p);
      }
      particles.current = next.slice(-600);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      off();
    };
  }, [subscribe]);

  return (
    <div className="card h-80">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">network activity</span>
        <span className="text-[11px] text-zinc-500">observed transactions · live</span>
      </div>
      <canvas ref={canvasRef} className="h-[calc(100%-1.5rem)] w-full" />
    </div>
  );
}
