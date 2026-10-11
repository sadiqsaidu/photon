"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive } from "@/lib/live";
import type { Mood } from "@/lib/types";
import { MOOD_WORD, samePriceLine } from "./Board";
import { FlapTile } from "./Flap";
import s from "./Home.module.css";

const MOOD_LINE: Record<Mood, string> = {
  quiet: "Tips in the last 20 seconds are below the usual level. A good moment to pay less.",
  busy: "Tips in the last 20 seconds are close to the usual level for the last 4 minutes.",
  rush: "Tips in the last 20 seconds are well above the usual level. Getting in fast costs more right now.",
};

export function MoodGauge() {
  const mood = useLive((st) => st.mood);
  const current = mood?.mood;
  return (
    <div className={s.mood} aria-live="polite">
      <p className={s.moodNow}>{current ? MOOD_WORD[current] : "Reading the market"}</p>
      <div className={s.gauge} role="img" aria-label={current ? `Market mood: ${MOOD_WORD[current]}` : "Market mood loading"}>
        {(["quiet", "busy", "rush"] as Mood[]).map((m) => (
          <span key={m} className={m === current ? s.on : undefined}>
            {MOOD_WORD[m]}
          </span>
        ))}
      </div>
      <p className={s.moodLine}>
        {current ? MOOD_LINE[current] : "Comparing the newest tips with the last 4 minutes."}
        {mood && mood.ratio !== 1 && (
          <span className={s.ratio}>
            {" "}
            Now {mood.ratio > 1 ? `${Math.round((mood.ratio - 1) * 100)}% above` : `${Math.round((1 - mood.ratio) * 100)}% below`} that level.
          </span>
        )}
      </p>
    </div>
  );
}

export function SamePrice() {
  const fares = useLive((st) => st.fares);
  const line = fares ? samePriceLine(fares.fares, fares.calibrated) : null;
  if (!line) return null;
  return (
    <p className={s.same} aria-live="polite">
      <span className={s.sameMark} aria-hidden="true">
        =
      </span>
      {line}
    </p>
  );
}

export function Learning() {
  const fares = useLive((st) => st.fares);
  const trips = useLive((st) => st.testTrips);
  if (!fares) return <p className={s.learning}>&nbsp;</p>;
  if (fares.calibrated)
    return (
      <p className={s.learning}>
        <FlapTile className={s.mini} />
        <span>
          Every chance on this board is checked against {trips?.trips ?? fares.progress.needed} real test trips.{" "}
          <Link href="/track-record">See the track record</Link>
        </span>
      </p>
    );
  return (
    <p className={s.learning}>
      <FlapTile className={s.mini} />
      <span>
        {fares.progress.done >= 10
          ? `The market moved, so Tipwise is testing a new price range: ${fares.progress.done} of ${fares.progress.needed} test trips done. Ranges already tested use real results.`
          : `Still learning: ${fares.progress.done} of ${fares.progress.needed} test trips done. Until then, the chances shown are starting estimates.`}{" "}
        <Link href="/track-record">How we check</Link>
      </span>
    </p>
  );
}

const SEEN_KEY = "tipwise-tip-explained";

export function TipNote() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(SEEN_KEY) !== "1");
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  };
  return (
    <aside className={s.note} aria-labelledby="tip-note-title">
      <p id="tip-note-title" className={s.noteTitle}>
        What is a tip?
      </p>
      <p>
        An extra payment to the validator building the block, so your transaction gets in ahead of others. Too little and it waits or misses. Too
        much and you overpay on every trade.
      </p>
      <button type="button" className="btn" onClick={close}>
        Got it
      </button>
    </aside>
  );
}
