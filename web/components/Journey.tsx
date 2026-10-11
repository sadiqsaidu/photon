"use client";

import { number, seconds } from "@/lib/format";
import type { Receipt, Stage } from "@/lib/types";
import s from "./Journey.module.css";

const STATIONS: { stage: Stage; label: string }[] = [
  { stage: "submitted", label: "Sent" },
  { stage: "processed", label: "Seen by the network" },
  { stage: "confirmed", label: "Confirmed" },
  { stage: "finalized", label: "Finalized" },
];

export function Journey({ receipt }: { receipt: Receipt | null }) {
  const stages = receipt?.stages ?? {};
  let reached = -1;
  STATIONS.forEach((st, i) => {
    if (stages[st.stage]) reached = i;
  });
  const failed = Boolean(receipt?.failure);
  const progress = reached < 0 ? 0 : reached / (STATIONS.length - 1);
  const live = receipt && !failed && reached < STATIONS.length - 1;
  return (
    <div className={s.journey}>
      <div className={s.line}>
        <span className={s.track} aria-hidden="true">
          <span className={s.done} style={{ ["--p" as string]: progress }} />
        </span>
        <span className={`${s.marker} ${live ? s.moving : ""} ${failed ? s.stopped : ""}`} style={{ ["--p" as string]: progress, left: `calc(12.5% + ${75 * progress}%)` }} aria-hidden="true" />
        <ol className={s.stations} aria-label="Journey of the transaction">
        {STATIONS.map((st, i) => {
          const at = stages[st.stage];
          const missed = failed && i === reached + 1;
          return (
            <li key={st.stage} className={`${s.station} ${at ? s.reached : ""} ${missed ? s.missed : ""}`}>
              <span className={s.stop} aria-hidden="true" />
              <span className={s.name}>{st.label}</span>
              <span className={s.when}>
                {at ? (
                  <>
                    {i === 0 ? "at send" : `+${seconds(at.ms)}`}
                    <span className={s.block}>block {number(at.slot)}</span>
                  </>
                ) : missed ? (
                  "did not arrive"
                ) : (
                  " "
                )}
              </span>
              <span className="sr-only">{at ? "reached" : missed ? "not reached" : "waiting"}</span>
            </li>
          );
        })}
        </ol>
      </div>
    </div>
  );
}
