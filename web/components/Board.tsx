"use client";

import { useEffect, useRef, useState } from "react";
import { blocks, pct, sol, usd } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useNow } from "@/lib/motion";
import { tipStanding } from "@/lib/fareNotes";
import type { Fare, Mood } from "@/lib/types";
import { Flaps } from "./Flap";
import { Odometer } from "./Odometer";
import s from "./Board.module.css";

export const MOOD_WORD: Record<Mood, string> = { quiet: "Quiet", busy: "Busy", rush: "Rush hour" };
const STALE_MS = 10_000;
const ANNOUNCE_MS = 10_000;

const targetText = (f: { confidence: number; deadlineSlots: number }) => `Target: ${pct(f.confidence)} within ${blocks(f.deadlineSlots)}`;

function chanceNote(f: Fare): string {
  const basis = f.estimate?.basis;
  if (basis === "prior") return "starting estimate";
  const trips = f.estimate && basis === "measured" ? `, ${f.estimate.samples} test trips` : "";
  if (basis === "inherited") return f.meetsConfidence ? "meets target, from a cheaper range" : `below ${pct(f.confidence)} target`;
  return f.meetsConfidence ? `meets ${pct(f.confidence)} target${trips}` : `below ${pct(f.confidence)} target${trips}`;
}

function tipText(f: Fare): string {
  if (f.tipUsd === null) return f.tipSol.toFixed(6);
  return f.tipUsd < 1 ? `$${f.tipUsd.toFixed(3)}` : `$${f.tipUsd.toFixed(2)}`;
}

function useCycling(active: boolean): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((x) => x + 1), 380);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return "";
  return `$0.${String((n * 7919) % 1000).padStart(3, "0")}`;
}

function tipSub(f: Fare): string {
  const standing = tipStanding(f);
  return standing ? `${sol(f.tipLamports)}, ${standing}` : sol(f.tipLamports);
}

function summary(fares: Fare[]): string {
  return fares
    .map((f) => `${f.label}: ${usd(f.tipUsd) || sol(f.tipLamports)} tip${tipStanding(f) ? `, ${tipStanding(f)}` : ""}, estimated ${pct(f.probability)} chance within ${blocks(f.deadlineSlots)}, ${f.meetsConfidence ? "meets" : "below"} the ${pct(f.confidence)} target.`)
    .join(" ");
}

export function Board() {
  const fares = useLive((st) => st.fares);
  const ready = useLive((st) => st.ready);
  const slot = useLive((st) => st.slot);
  const lastSlotAt = useLive((st) => st.lastSlotAt);
  const mood = useLive((st) => st.mood);
  useNow(1_000);
  const stale = ready && lastSlotAt > 0 && performance.now() - lastSlotAt > STALE_MS;
  const rows = fares?.fares ?? [];
  const cycling = useCycling(!fares);
  const [announce, setAnnounce] = useState("");
  const announcedAt = useRef(0);

  useEffect(() => {
    if (!fares || Date.now() - announcedAt.current < ANNOUNCE_MS) return;
    announcedAt.current = Date.now();
    setAnnounce(summary(fares.fares));
  }, [fares]);

  const status = !fares ? "CONNECT" : stale ? "WAITING" : mood ? MOOD_WORD[mood.mood] : "";
  const placeholder = [
    { id: "saver", label: "Saver" },
    { id: "standard", label: "Standard" },
    { id: "express", label: "Express" },
  ];

  return (
    <section className={`${s.board} ${stale ? s.stale : ""} ${fares?.warmingUp ? s.warming : ""}`} aria-labelledby="board-title">
      <h2 id="board-title" className="sr-only">
        Live fares
      </h2>
      <div className={s.head}>
        <div className={s.next}>
          <span className={s.label}>Next block</span>
          <Odometer value={slot ? slot + 1 : 0} label={slot ? `Next block ${(slot + 1).toLocaleString("en-US")}` : "Waiting for the first block"} />
        </div>
        <div className={s.status}>
          <span className={s.label}>{stale ? "Waiting for the next block" : fares ? "Market" : "Connecting to mainnet"}</span>
          <Flaps text={status} length={9} align="right" className={s.statusFlaps} />
        </div>
      </div>

      <div className={s.cols} aria-hidden="true">
        <span>Fare</span>
        <span>Tip</span>
        <span>Target time</span>
        <span>Estimated chance</span>
      </div>

      <ul className={s.rows}>
        {(rows.length ? rows : placeholder).map((row, i) => {
          const f = rows.length ? (row as Fare) : null;
          const offset = i * 140;
          return (
            <li key={row.id} className={s.row}>
              <div className={s.fare}>
                <Flaps text={row.label} length={8} offset={offset} className={s.fareFlaps} label={row.label} />
                <span className={s.sub}>{f ? targetText(f) : "\u00a0"}</span>
              </div>
              <div className={s.tip}>
                <Flaps text={f ? tipText(f) : cycling} length={6} align="right" offset={offset + 60} className={s.big} label={f ? `Tip ${usd(f.tipUsd) || sol(f.tipLamports)}` : undefined} />
                <span className={s.sub}>{f ? tipSub(f) : " "}</span>
              </div>
              <div className={s.time}>
                <span className={s.timeValue}>
                  <Flaps text={f ? (f.deadlineMs / 1000).toFixed(1) : ""} length={3} align="right" offset={offset + 120} className={s.big} label={f ? `Target time about ${(f.deadlineMs / 1000).toFixed(1)} seconds` : undefined} />
                  <span className={s.unit}>s</span>
                </span>
                <span className={s.sub}>{f ? `${blocks(f.deadlineSlots)}, approx.` : " "}</span>
              </div>
              <div className={`${s.chance} ${f && !f.meetsConfidence ? s.dim : ""}`}>
                <span className={s.chanceValue}>
                  <span className={`${s.lamp} ${f ? (f.meetsConfidence ? s.ok : s.effort) : ""}`} aria-hidden="true" />
                  <Flaps text={f ? pct(f.probability) : ""} length={3} align="right" offset={offset + 180} className={s.big} label={f ? `Estimated ${pct(f.probability)} chance` : undefined} />
                </span>
                <span className={s.sub}>{f ? chanceNote(f) : " "}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}
