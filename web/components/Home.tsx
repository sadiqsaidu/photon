"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive } from "@/lib/live";
import type { Mood } from "@/lib/types";
import { fareNotes } from "@/lib/fareNotes";
import { MOOD_WORD } from "./Board";
import { FlapTile } from "./Flap";
import s from "./Home.module.css";

const MOOD_LINE: Record<Mood, string> = {
  quiet: "Tips in the last 20 seconds are below the usual level. A good moment to pay less.",
  busy: "Tips in the last 20 seconds are close to the usual level for the last 4 minutes.",
  rush: "Tips in the last 20 seconds are well above the usual level for the last 4 minutes.",
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

const NOTE_MARK = { same: "=", ceiling: "=", gain: "i", unmet: "!" } as const;

export function FareNotes() {
  const fares = useLive((st) => st.fares);
  const notes = fares ? fareNotes(fares.fares, fares.tipCeilingLamports) : [];
  const ceiling = fares?.tipCeilingLamports ? `${fares.tipCeilingLamports / 1e9} SOL` : "";
  const market = fares?.pricing === "market-percentile";
  const stepped = fares?.fares.some((f) => f.stepApplied);
  return (
    <div className={s.notes} aria-live="polite">
      {notes.map((n) => (
        <p key={n.text.slice(0, 40)} className={`${s.same} ${n.kind === "gain" ? s.quiet : ""}`}>
          <span className={`${s.sameMark} ${n.kind === "unmet" ? s.unmetMark : ""}`} aria-hidden="true">
            {NOTE_MARK[n.kind]}
          </span>
          {n.text}
        </p>
      ))}
      <details className={s.method}>
        <summary>How prices and estimates work</summary>
        {market ? (
          <div className={s.methodBody}>
            <p>Prices come from where landed tips sit today; chances come from Tipwise&apos;s test trips.</p>
            <p>
              Saver pays the typical landed tip, the median of tips at or above the Beam minimum over the last 600 blocks (about four minutes). Standard pays
              the 75th percentile, the top quarter, and Express the 90th, the top tenth. Each price is the median of its last five readings, rounded to two
              significant figures, so it does not flicker. If two fares would share a price, the pricier one is raised to at least 1.25 times the one below
              {stepped ? " (applied right now)" : ""}. Tips are capped at the {ceiling} ceiling, the only case where two fares can share a price.
            </p>
            <p>
              Each fare is a target: a deadline in blocks and the chance its estimate is judged against. The chance shown is our estimate for the range
              the fare&apos;s tip falls in, from real test trips through Solami Beam: ten trips that all land give about 92%, an estimate from ten
              observations, not a measured long-run rate. Where a pricier range did worse than a cheaper one, the two are averaged. A range with too few
              trips borrows the estimate of the cheaper range below it.
            </p>
            <p>
              A higher tip buys position when blocks get crowded. It does not guarantee an earlier block, and our test trips may not show a gain. Every
              fare is sent the same way, through Beam with the same priority fee. Times in seconds assume 0.4 seconds per block and are approximate.
            </p>
          </div>
        ) : (
          <div className={s.methodBody}>
            <p>
              Each fare is a target, not a separate lane: a deadline in blocks and the chance Tipwise aims for. Every fare is sent the same way, through
              Solami Beam with the same priority fee, so two fares with the same tip are the same transaction.
            </p>
            <p>
              The tip is the cheapest range of tips Beam accepts whose estimated chance reaches the target. Estimates come from real test trips in each
              range: ten trips that all land give about 92%, an estimate from ten observations, not a measured long-run rate.
              {fares?.fares[0]?.estimate
                ? " Where a pricier range did worse than a cheaper one, the two are averaged, since a bigger tip is assumed not to lower the chance. A range with too few trips borrows the estimate of the cheaper range below it."
                : ""}
            </p>
            <p>
              If no range reaches a fare&apos;s target, the board shows the cheapest tip with the best estimate and marks the target as not met. Tips above
              the {ceiling} ceiling are never quoted or tested. Times in seconds assume 0.4 seconds per block and are approximate.
            </p>
          </div>
        )}
      </details>
    </div>
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
          Estimates come from {trips?.trips ?? fares.progress.needed} real test trips through Beam.{" "}
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
