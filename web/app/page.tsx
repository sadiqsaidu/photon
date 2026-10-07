"use client";

import { useEffect, useRef, useState } from "react";
import { Calibration } from "@/components/Calibration";
import { Leaders } from "@/components/Leaders";
import { ProbeLanes } from "@/components/ProbeLanes";
import { QuoteWidget } from "@/components/QuoteWidget";
import { TipSurface } from "@/components/TipSurface";
import { TopBar } from "@/components/TopBar";
import { useLive, type StreamHealth } from "@/lib/events";

function StreamPanel({ streams }: { streams: StreamHealth[] }) {
  const last = useRef<{ at: number; bytes: Record<string, number> } | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  useEffect(() => {
    const now = Date.now();
    const bytes = Object.fromEntries(streams.map((s) => [s.name, s.bytes]));
    const prev = last.current;
    if (prev && now - prev.at > 1_000) {
      setRates(Object.fromEntries(streams.map((s) => [s.name, ((s.bytes - (prev.bytes[s.name] ?? s.bytes)) * 1000) / (now - prev.at) / 1e6])));
    }
    last.current = { at: now, bytes };
  }, [streams]);
  const queue = streams.find((s) => s.queue)?.queue;
  const blocked = streams.filter((s) => s.blocked);
  return (
    <section className="panel">
      <div className="title">
        <span className="label">stream health</span>
        {queue && (
          <span className={`tag ${queue.depth > queue.capacity / 2 ? "bad" : "good"}`}>
            gRPC queue {queue.depth.toLocaleString("en-US")} (peak {queue.maxDepth.toLocaleString("en-US")} of {queue.capacity.toLocaleString("en-US")})
          </span>
        )}
      </div>
      {blocked.map((s) => (
        <p key={s.name} className="tag bad" style={{ marginTop: 0 }}>
          {s.name} refused by Solami: {s.blocked}. Serving stored data; retrying every 5 minutes.
        </p>
      ))}
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>stream</th>
              <th>state</th>
              <th className="r">MB/s</th>
              <th className="r">reconnects</th>
              <th className="r">backpressure closures</th>
            </tr>
          </thead>
          <tbody>
            {streams.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>
                  <span className={`live ${s.connected ? "" : "down"}`} />
                  {s.connected ? "up" : s.blocked ? "refused" : "reconnecting"}
                </td>
                <td className="r">{rates[s.name] === undefined ? "-" : rates[s.name]?.toFixed(3)}</td>
                <td className="r">{s.reconnects}</td>
                <td className="r">{s.backpressureClosures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {queue && queue.dropped > 0 && <p className="faint" style={{ margin: "8px 0 0", fontSize: 11 }}>{queue.dropped.toLocaleString("en-US")} transaction updates shed while the queue was full.</p>}
    </section>
  );
}

export default function Dashboard() {
  const live = useLive();
  const s = live.stats;
  return (
    <main className="shell">
      <TopBar live={live} />
      {live.error && !s && (
        <div className="panel">
          <span className="tag bad">backend unreachable</span> <span className="muted">{live.error}. Start it with npm run serve.</span>
        </div>
      )}
      {s && s.degraded.length > 0 && (
        <div className="panel" role="status">
          <span className="tag bad">degraded</span>{" "}
          {s.degraded.map((d) => (
            <span key={d.feature} className="muted" style={{ marginRight: 12 }}>
              {d.feature}: {d.error}
            </span>
          ))}
          <span className="faint">Stored data stays available; refused streams retry every 5 minutes.</span>
        </div>
      )}
      <QuoteWidget />
      <TipSurface stats={s} />
      <div className="grid-2">
        <Calibration stats={s} />
        <ProbeLanes stats={s} />
      </div>
      <div className="grid-2">
        <Leaders stats={s} />
        <StreamPanel streams={s?.streams ?? []} />
      </div>
    </main>
  );
}
