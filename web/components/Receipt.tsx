"use client";

import type { ReactNode } from "react";
import { useReducedMotion } from "@/lib/motion";
import s from "./Receipt.module.css";

export type StampKind = "overpaid" | "fair" | "too_low" | "landed" | "missed";

const STAMP: Record<StampKind, { text: string; tone: "red" | "green" }> = {
  overpaid: { text: "OVERPAID", tone: "red" },
  too_low: { text: "TOO LOW", tone: "red" },
  missed: { text: "MISSED", tone: "red" },
  fair: { text: "FAIR", tone: "green" },
  landed: { text: "LANDED", tone: "green" },
};

export type Line =
  | { kind: "item"; label: ReactNode; value: ReactNode; strong?: boolean; tone?: "live" }
  | { kind: "sub"; value: ReactNode }
  | { kind: "rule" }
  | { kind: "text"; value: ReactNode; big?: boolean; muted?: boolean };

const LINE_MS = 30;

export function Stamp({ kind, delay = 0 }: { kind: StampKind; delay?: number }) {
  const st = STAMP[kind];
  return (
    <div className={`${s.stamp} ${s[st.tone]}`} style={{ animationDelay: `${delay}ms` }} role="img" aria-label={`Stamped ${st.text.toLowerCase()}`}>
      <svg className={s.inkDefs} aria-hidden="true" width="0" height="0">
        <filter id="tipwise-ink">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.9 0.72 0.95" />
          </feComponentTransfer>
        </filter>
      </svg>
      <span>{st.text}</span>
    </div>
  );
}

export function Receipt({
  title,
  meta,
  lines,
  footer,
  stamp,
  print = true,
  label,
}: {
  title: string;
  meta?: ReactNode;
  lines: Line[];
  footer?: ReactNode;
  stamp?: StampKind | null;
  print?: boolean;
  label: string;
}) {
  const reduced = useReducedMotion();
  const animate = print && !reduced;
  const total = Math.min(1_150, (lines.length + 4) * LINE_MS);
  return (
    <div className={s.printer}>
      <div className={s.slot} aria-hidden="true" />
      <div className={s.feed}>
        <article className={`${s.paper} ${animate ? s.printing : ""}`} style={{ animationDuration: `${total}ms` }} aria-label={label}>
          <h2 className={s.title}>{title}</h2>
          {meta && <p className={s.meta}>{meta}</p>}
          <div className={s.lines}>
            {lines.map((l, i) => {
              if (l.kind === "rule") return <hr key={i} className={s.rule} />;
              if (l.kind === "sub")
                return (
                  <p key={i} className={s.sub}>
                    {l.value}
                  </p>
                );
              if (l.kind === "text")
                return (
                  <p key={i} className={`${l.big ? s.big : ""} ${l.muted ? s.muted : ""}`}>
                    {l.value}
                  </p>
                );
              return (
                <p key={i} className={`${s.item} ${l.tone === "live" ? s.live : ""} ${l.strong ? s.strong : ""}`}>
                  <span className={s.k}>{l.label}</span>
                  <span className={s.lead} aria-hidden="true" />
                  <span className={s.v}>{l.value}</span>
                </p>
              );
            })}
          </div>
          <div className={s.stampZone}>{stamp && <Stamp kind={stamp} delay={animate ? total + 120 : 0} />}</div>
          {footer && <p className={s.footer}>{footer}</p>}
        </article>
      </div>
    </div>
  );
}

export function PrinterWaiting({ children }: { children: ReactNode }) {
  return (
    <div className={s.printer}>
      <div className={`${s.slot} ${s.busy}`} aria-hidden="true" />
      <div className={s.waiting} role="status">
        {children}
      </div>
    </div>
  );
}
