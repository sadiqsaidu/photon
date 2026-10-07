"use client";

import Link from "next/link";
import type { Live } from "@/lib/events";
import { sol } from "@/lib/format";

function Odometer({ value }: { value: number }) {
  if (!value) return <span className="faint">-</span>;
  return (
    <span className="odo" aria-label={String(value)}>
      {value
        .toLocaleString("en-US")
        .split("")
        .map((c, i, all) =>
          c === "," ? (
            <span key={`c${i}`} className="faint">
              ,
            </span>
          ) : (
            <span key={`d${all.length - i}`} className="d">
              <span className="reel" style={{ transform: `translateY(-${Number(c)}em)` }}>
                {Array.from({ length: 10 }, (_, n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </span>
          ),
        )}
    </span>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{children}</div>
    </div>
  );
}

export function TopBar({ live }: { live: Live }) {
  const s = live.stats;
  const race = s?.race;
  const lead = race?.grpcLeadP50Ms;
  const beam = s?.receipts.find((r) => r.beam);
  const allUp = s ? s.streams.every((x) => x.connected) : false;
  return (
    <header className="panel topbar">
      <div className="brand">
        PHOTON <span className="faint" style={{ fontWeight: 400, letterSpacing: 0 }}>tip oracle with receipts</span>
        <div style={{ fontWeight: 400, letterSpacing: 0, marginTop: 4, fontSize: 12 }}>
          <Link href="/">weather</Link> <span className="faint">/</span> <Link href="/audit">tip audit</Link>
        </div>
      </div>
      <Metric label="slot">
        <span className={`live ${live.connected && allUp ? "" : "down"}`} />
        <Odometer value={s?.slot ?? 0} />
      </Metric>
      <Metric label="gRPC vs Mirage">
        {race ? (
          <>
            {race.wins.grpc} / {race.wins.mirage}{" "}
            <span className="muted">
              {lead === null || lead === undefined ? "" : lead >= 0 ? `gRPC +${lead} ms` : `Mirage +${-lead} ms`}
            </span>
          </>
        ) : (
          "-"
        )}
      </Metric>
      <Metric label="behind chain tip">{s ? `${s.behind} slots` : "-"}</Metric>
      <Metric label="Blur events/s">{live.blurPerSec === null ? "-" : Math.round(live.blurPerSec).toLocaleString("en-US")}</Metric>
      <Metric label="Beam">
        {beam?.beam ? (
          <span className={`tag ${beam.beam.is_landed ? "good" : "bad"}`}>
            {beam.beam.is_landed ? "landed" : "not landed"} {beam.beam.region}
          </span>
        ) : (
          <span className="tag">no sends yet</span>
        )}
      </Metric>
      <Metric label="probe budget left">
        {s?.probe.wallet ? `${sol(s.probe.leftLamports, 4)} SOL` : <span className="faint">probes off</span>}
      </Metric>
    </header>
  );
}
