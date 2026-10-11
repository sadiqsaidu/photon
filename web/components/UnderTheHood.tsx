"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { lamportsToUsd, number, shortAddress, sol, usd } from "@/lib/format";
import { getWindow, useLive } from "@/lib/live";
import type { Leader } from "@/lib/types";
import { STATUS_WORD, StatusDot } from "./Chrome";
import s from "./UnderTheHood.module.css";

function Products() {
  const products = useLive((st) => st.products);
  return (
    <ul className={s.products}>
      {products.map((p) => (
        <li key={p.id} className={s.product}>
          <div className={s.pname}>
            <StatusDot status={p.status} />
            <span>{p.name}</span>
          </div>
          <p className={s.job}>{p.job}</p>
          <p className={s.metric}>{p.metric}</p>
          <p className={s.state}>{STATUS_WORD[p.status]}</p>
        </li>
      ))}
      {!products.length && <li className={s.product}>Connecting to the live feed.</li>}
    </ul>
  );
}

function Race() {
  const race = useLive((st) => st.race);
  const products = useLive((st) => st.products);
  const live = products.find((p) => p.id === "mirage")?.values as { wins?: { grpc: number; mirage: number }; grpcLeadP50Ms?: number | null } | undefined;
  const wins = live?.wins ?? race?.wins ?? { grpc: 0, mirage: 0 };
  const lead = live?.grpcLeadP50Ms ?? race?.grpcLeadP50Ms ?? null;
  const total = wins.grpc + wins.mirage || 1;
  return (
    <div className={s.race}>
      {(["grpc", "mirage"] as const).map((k) => (
        <div key={k} className={s.lane}>
          <span className={s.laneName}>{k === "grpc" ? "Yellowstone gRPC" : "Mirage"}</span>
          <span className={s.laneTrack}>
            <span className={`${s.laneBar} ${k === "grpc" ? s.ink : s.amber}`} style={{ width: `${(wins[k] / total) * 100}%` }} />
          </span>
          <span className={s.laneValue}>
            first {number(wins[k])} times ({Math.round((wins[k] / total) * 100)}%)
          </span>
        </div>
      ))}
      <p className="small muted">
        Both streams report every new block. For each block, whichever arrives first wins.{" "}
        {lead === null ? "" : `Median lead: gRPC ${lead >= 0 ? "ahead" : "behind"} by ${Math.abs(lead)} ms.`} The two are close, which is the point:
        Mirage gives the same signal over a plain WebSocket.
      </p>
    </div>
  );
}

function Leaders() {
  const price = useLive((st) => st.solPrice);
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.leaders().then((l) => alive && setLeaders(l), () => undefined);
    load();
    const t = setInterval(load, 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!leaders) return <p className="muted">Loading the schedule.</p>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">Blocks</th>
            <th scope="col">Builder (validator identity)</th>
            <th scope="col">Median tip in its blocks</th>
            <th scope="col">Skipped blocks seen</th>
          </tr>
        </thead>
        <tbody>
          {leaders.slice(0, 10).map((l) => (
            <tr key={l.firstSlot}>
              <td className="mono">
                {number(l.firstSlot)}
                {l.lastSlot > l.firstSlot ? ` to ${String(l.lastSlot).slice(-3)}` : ""}
              </td>
              <td className="mono">{shortAddress(l.identity, 6)}</td>
              <td>{l.medianTip === null ? "not seen yet" : usd(lamportsToUsd(l.medianTip, price)) || sol(l.medianTip)}</td>
              <td>{l.skipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Heat() {
  const lag = useLive((st) => st.lag);
  const version = useLive((st) => st.windowVersion);
  const rows = getWindow().slice(-200);
  const max = Math.max(1, ...rows.map((r) => r.heat));
  return (
    <div className={s.heat}>
      <p className={s.lagText}>
        {!lag || lag.n === 0
          ? "Collecting enough blocks for the test."
          : lag.qualifies
            ? `Yes, a little. Market activity leads tips by ${lag.k} blocks (correlation ${lag.r.toFixed(2)} over ${number(lag.n)} blocks), so the forecast uses it.`
            : `Not right now. The strongest link is ${lag.r.toFixed(2)} at ${lag.k} blocks ahead over ${number(lag.n)} blocks, below the 0.2 Tipwise needs before it lets activity move a price.`}
      </p>
      <svg className={s.strip} viewBox={`0 0 ${rows.length || 1} 40`} preserveAspectRatio="none" role="img" aria-label="Blur market activity per block, last 200 blocks" data-v={version}>
        {rows.map((r, i) => (
          <rect key={r.slot} x={i} width={0.8} y={40 - (r.heat / max) * 40} height={(r.heat / max) * 40} fill="#d98e00" />
        ))}
      </svg>
      <p className="small muted">
        Blur heat per block for the last 200 blocks: swaps of $100 or more count 1, token launches 3, new pools and surges 5, graduations 10. Every 30
        seconds Tipwise correlates heat at block t with tips at block t+k for k from 0 to 20.
      </p>
    </div>
  );
}

function Health() {
  const streams = useLive((st) => st.streams);
  const behind = useLive((st) => st.behind);
  const maxBehind = useLive((st) => st.maxBehind);
  const products = useLive((st) => st.products);
  const grpc = products.find((p) => p.id === "grpc")?.values as { mbps?: number; queue?: number; reconnects?: number } | undefined;
  const cells = [
    { k: "gRPC bandwidth", v: grpc?.mbps !== undefined ? `${grpc.mbps.toFixed(2)} MB/s` : "" },
    { k: "Queue depth", v: grpc?.queue !== undefined ? number(grpc.queue) : "" },
    { k: "Reconnects", v: number(streams.reduce((a, x) => a + x.reconnects, 0)) },
    { k: "Behind the chain tip", v: `${behind} now, ${maxBehind} worst` },
  ];
  return (
    <dl className={s.health}>
      {cells.map((c) => (
        <div key={c.k}>
          <dt>{c.k}</dt>
          <dd>{c.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Calibration() {
  const cal = useLive((st) => st.calibration);
  if (!cal) return null;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">Percentile bucket</th>
            <th scope="col">Probes</th>
            <th scope="col">Predicted</th>
            <th scope="col">Landed within {cal.deadlineSlots} slots</th>
            <th scope="col">Model</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {cal.buckets.map((b) => (
            <tr key={b.lo}>
              <td>
                p{b.lo} to p{b.hi}
              </td>
              <td>{b.n}</td>
              <td>{b.predicted === null ? "" : b.predicted.toFixed(2)}</td>
              <td>{b.actual === null ? "" : b.actual.toFixed(2)}</td>
              <td>{b.model.toFixed(2)}</td>
              <td>{b.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 10 }}>
        {cal.probes} probes, Brier score {cal.brier === null ? "not yet" : cal.brier.toFixed(3)}, {cal.calibrated ? "calibrated" : "not calibrated yet (10 probes per reachable bucket)"}.
      </p>
    </div>
  );
}

export function UnderTheHoodView() {
  return (
    <div className={s.page}>
      <section className={s.intro}>
        <h1 className="h1">Under the hood</h1>
        <p className="lede">Tipwise runs on eight Solami products at once. Each one has a single job, and each one is live right now.</p>
      </section>
      <section className={s.block} aria-labelledby="products-title">
        <h2 id="products-title" className="h2">
          Eight Solami products
        </h2>
        <Products />
      </section>
      <section className={s.block} aria-labelledby="race-title">
        <h2 id="race-title" className="h2">
          gRPC versus Mirage
        </h2>
        <Race />
      </section>
      <section className={s.block} aria-labelledby="leaders-title">
        <h2 id="leaders-title" className="h2">
          Next block builders
        </h2>
        <p className="muted" style={{ margin: "8px 0 16px" }}>
          The validators due to build the next blocks, from getSlotLeaders, with what Tipwise has measured in their past blocks.
        </p>
        <Leaders />
      </section>
      <section className={s.block} aria-labelledby="heat-title">
        <h2 id="heat-title" className="h2">
          Does market activity move tips?
        </h2>
        <Heat />
      </section>
      <section className={s.block} aria-labelledby="health-title">
        <h2 id="health-title" className="h2">
          Stream health
        </h2>
        <Health />
      </section>
      <section className={s.block} aria-labelledby="cal-title">
        <h2 id="cal-title" className="h2">
          Landing model calibration
        </h2>
        <p className="muted" style={{ margin: "8px 0 16px", maxWidth: "70ch" }}>
          The raw numbers behind the track record: every probe scored against a 2 slot deadline, per percentile bucket of tips at or above the Beam
          floor, with the Laplace-smoothed model probability.
        </p>
        <Calibration />
      </section>
    </div>
  );
}
