"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { blocks, blocksToSeconds, lamportsToUsd, number, pct, sol, solscan, usd } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Receipt, Stats, TrackRecord as TR } from "@/lib/types";
import s from "./TrackRecord.module.css";

const RANGE_WORDS: Record<string, string> = {
  "0-25": "Cheapest quarter of tips",
  "25-50": "Second quarter",
  "50-75": "Third quarter",
  "75-90": "Next 15 percent",
  "90-100": "Top 10 percent",
};

type Data = TR & { testTrips: Stats["testTrips"]; recent: Receipt[] };

function Dumbbell({ data }: { data: TR }) {
  return (
    <div className={s.chart}>
      <div className={s.axis} aria-hidden="true">
        {[0, 25, 50, 75, 100].map((t) => (
          <span key={t} style={{ left: `${t}%` }}>
            {t}%
          </span>
        ))}
      </div>
      <ul className={s.rows}>
        {data.rows.map((r) => {
          const key = `${r.lo}-${r.hi}`;
          const tested = r.n > 0 && r.promised !== null && r.delivered !== null;
          const lo = tested ? Math.min(r.promised!, r.delivered!) : 0;
          const hi = tested ? Math.max(r.promised!, r.delivered!) : 0;
          return (
            <li key={key} className={s.row}>
              <div className={s.label}>
                <span className={s.range}>{RANGE_WORDS[key] ?? key}</span>
                <span className={s.n}>
                  {tested ? `${r.n} test ${r.n === 1 ? "trip" : "trips"}` : r.reachable ? "No test trips yet" : "Above our tip ceiling, not tested"}
                </span>
              </div>
              <div className={s.track}>
                {[25, 50, 75].map((t) => (
                  <span key={t} className={s.grid} style={{ left: `${t}%` }} aria-hidden="true" />
                ))}
                {tested && (
                  <>
                    <span className={s.bar} style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} aria-hidden="true" />
                    <span className={`${s.dot} ${s.promised}`} style={{ left: `${r.promised! * 100}%` }} aria-hidden="true" />
                    <span className={`${s.dot} ${s.delivered}`} style={{ left: `${r.delivered! * 100}%` }} aria-hidden="true" />
                    <span className="sr-only">
                      Promised {pct(r.promised!)}, delivered {pct(r.delivered!)}.
                    </span>
                  </>
                )}
              </div>
              <div className={s.values}>{tested ? `${pct(r.promised!)} promised, ${pct(r.delivered!)} on time` : ""}</div>
            </li>
          );
        })}
      </ul>
      <div className={s.legend}>
        <span>
          <i className={`${s.key} ${s.promised}`} />
          What we promised
        </span>
        <span>
          <i className={`${s.key} ${s.delivered}`} />
          What actually happened
        </span>
      </div>
    </div>
  );
}

// Which way the gap goes matters: cautious starting estimates that the trips
// beat read very differently from promises the trips missed.
function verdict(data: TR, now: number | null): string {
  if (data.trips === 0) return "No test trips have settled yet. The first ones go out a minute after the server starts.";
  const used = data.rows.filter((r) => r.n > 0 && r.promised !== null && r.delivered !== null);
  const total = used.reduce((a, r) => a + r.n, 0) || 1;
  const promised = used.reduce((a, r) => a + r.n * (r.promised as number), 0) / total;
  const delivered = used.reduce((a, r) => a + r.n * (r.delivered as number), 0) / total;
  const trips = `${number(data.trips)} test trips`;
  if (delivered - promised > 0.05)
    return `We under-promised. Across ${trips}, Tipwise promised ${pct(promised)} on average and ${pct(delivered)} landed on time: the starting estimates were cautious.${now === null ? "" : ` With every price range tested, the board now promises ${pct(now)}.`}`;
  if (promised - delivered > 0.05) return `We over-promised. Across ${trips}, Tipwise promised ${pct(promised)} on average and only ${pct(delivered)} landed on time.`;
  return `Across ${trips}, we were within ${data.averageGapPoints ?? 0} points of what we promised on average.`;
}

function Stub({ r, price }: { r: Receipt; price: number | null }) {
  const landed = r.landedSlot !== null && r.failure === null;
  const n = r.landedSlot === null ? null : Math.max(1, r.landedSlot - r.sentSlot);
  return (
    <li className={s.stub}>
      <span className={s.time}>{new Date(r.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</span>
      <span className={s.tip}>
        {usd(lamportsToUsd(r.tip, price)) || sol(r.tip)}
        <span>{sol(r.tip)}</span>
      </span>
      <span className={s.blocks}>{n === null ? "did not land" : `${blocks(n)} to land`}</span>
      <span className={`${s.mini} ${landed ? s.ok : s.bad}`}>{landed ? "LANDED" : "MISSED"}</span>
      <a href={solscan(r.signature)} target="_blank" rel="noreferrer" className={s.link}>
        Solscan
      </a>
    </li>
  );
}

export function TrackRecordView() {
  const price = useLive((st) => st.solPrice);
  const fares = useLive((st) => st.fares);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .trackRecord()
        .then((d) => alive && (setData(d), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const progress = fares?.progress;
  return (
    <div className={s.page}>
      <section className={s.intro}>
        <h1 className="h1">We test our own predictions with real transactions.</h1>
        <p className="lede">Every few minutes Tipwise sends a small real transaction to check its own predictions. Here is how they held up.</p>
      </section>

      {error && !data && <p className="error">The track record could not be loaded right now. It refreshes by itself.</p>}

      {data && (
        <>
          <section className={s.block} aria-labelledby="promise-title">
            <div className={s.head}>
              <h2 id="promise-title" className="h2">
                Promise versus reality
              </h2>
              <p className="muted">
                The chance of landing within {blocks(data.deadlineSlots)} ({blocksToSeconds(data.deadlineSlots)}), the Standard fare, by how much a
                trip tipped compared with other tips Beam accepts. Each trip is scored against what Tipwise would have promised before it was sent.
              </p>
            </div>
            <p className={s.summary}>
              {verdict(data, fares?.fares.find((f) => f.id === "standard")?.probability ?? null)}{" "}
              {fares?.calibrated
                ? "Predictions are checked: every price range Tipwise quotes has at least 10 test trips."
                : progress
                  ? `Still learning: ${progress.done} of ${progress.needed} test trips done. Until then the promises are starting estimates.`
                  : ""}
            </p>
            <Dumbbell data={data} />
          </section>

          <section className={s.block} aria-labelledby="trips-title">
            <h2 id="trips-title" className="h2">
              Recent test trips
            </h2>
            {data.recent.length ? (
              <ul className={s.stubs}>
                {data.recent.map((r) => (
                  <Stub key={r.signature} r={r} price={price} />
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ marginTop: 12 }}>
                None yet.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
