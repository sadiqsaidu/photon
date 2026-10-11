"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";
import s from "./Flap.module.css";

const NARROW = new Set([".", ",", ":"]);

function FlapChar({ ch, delay, instant }: { ch: string; delay: number; instant: boolean }) {
  const [cur, setCur] = useState(ch);
  const [prev, setPrev] = useState(ch);
  const [turn, setTurn] = useState(0);
  const latest = useRef(ch);

  useEffect(() => {
    if (ch === latest.current) return;
    setPrev(instant ? ch : latest.current);
    latest.current = ch;
    setCur(ch);
    if (!instant) setTurn((t) => t + 1);
  }, [ch, instant]);

  const glyph = (c: string) => (c === " " ? " " : c);
  const flipping = prev !== cur;
  return (
    <span className={`${s.cell} ${NARROW.has(cur) ? s.narrow : ""}`} aria-hidden="true">
      <span className={`${s.half} ${s.top}`}>
        <span className={s.glyph}>{glyph(cur)}</span>
      </span>
      <span className={`${s.half} ${s.bottom}`}>
        <span className={s.glyph}>{glyph(flipping ? prev : cur)}</span>
      </span>
      {flipping && (
        <span key={turn} className={s.leaves}>
          <span className={`${s.half} ${s.top} ${s.leafTop}`} style={{ animationDelay: `${delay}ms` }}>
            <span className={s.glyph}>{glyph(prev)}</span>
          </span>
          <span
            className={`${s.half} ${s.bottom} ${s.leafBottom}`}
            style={{ animationDelay: `${delay + 60}ms` }}
            onAnimationEnd={() => setPrev(cur)}
          >
            <span className={s.glyph}>{glyph(cur)}</span>
          </span>
        </span>
      )}
    </span>
  );
}

export function Flaps({
  text,
  length,
  align = "left",
  stagger = 30,
  offset = 0,
  label,
  className,
}: {
  text: string;
  length?: number;
  align?: "left" | "right";
  stagger?: number;
  offset?: number;
  label?: string;
  className?: string;
}) {
  const instant = useReducedMotion();
  const n = Math.max(length ?? 0, text.length);
  const padded = align === "left" ? text.padEnd(n) : text.padStart(n);
  return (
    <span className={`${s.flaps} ${className ?? ""}`} role={label ? "img" : undefined} aria-label={label}>
      {[...padded].map((ch, i) => (
        <FlapChar key={i} ch={ch.toUpperCase()} delay={offset + i * stagger} instant={instant} />
      ))}
    </span>
  );
}

export function FlapTile({ ch = "T", className }: { ch?: string; className?: string }) {
  return (
    <span className={`${s.tile} ${className ?? ""}`} aria-hidden="true">
      {ch}
    </span>
  );
}
