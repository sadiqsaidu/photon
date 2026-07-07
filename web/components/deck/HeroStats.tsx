"use client";

import { bundleCounts, useStore, yourBundles } from "@/lib/store";
import { sol } from "@/lib/format";

function Tile({
  label,
  children,
  foot,
}: {
  label: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className="panel relative flex-1 overflow-hidden p-4">
      <div className="label mb-2">{label}</div>
      {children}
      {foot && <div className="mt-2 flex flex-wrap items-center gap-1.5">{foot}</div>}
    </div>
  );
}

// "fra.grpc.solinfra.dev" -> "solinfra"
function orgLabel(host: string): string {
  const parts = host.split(".");
  return parts.length >= 2 ? (parts[parts.length - 2] as string) : host;
}

// Left rail: the four numbers that matter, wallet-app large.
export function HeroStats() {
  const { state } = useStore();
  const p = state.tipPolicy;
  const n = state.network;
  const counts = bundleCounts(state);

  const landRate = p ? Math.round(p.landRate * 100) : null;
  const trend = p?.forecast.trendPctPer10Slots ?? null;
  const rising = trend !== null && trend > 0.05;
  const falling = trend !== null && trend < -0.05;

  const race = state.race;
  const two = race && race.providers.length >= 2;
  const totalWins = race ? race.providers.reduce((a, b) => a + b.wins, 0) : 0;

  // Session tip economics. Bundles are atomic: a failed bundle never pays its
  // tip, so "spent" counts landed bundles only and in-flight tips are exposure.
  let spent = 0;
  let exposure = 0;
  for (const l of yourBundles(state)) {
    if (l.failure) continue;
    if (l.stages.finalized) spent += l.tip;
    else exposure += l.tip;
  }
  const avgTip = counts.landed > 0 ? spent / counts.landed : null;

  return (
    <div className="flex h-full flex-col gap-px">
      <Tile
        label="ai tip · lamports as sol"
        foot={
          p && (
            <>
              <span className="tag-gilt">
                {p.anchor} × {p.multiplier}
              </span>
              <span className={p.floorSource === "local" ? "tag-moss" : "tag-ghost"}>
                floor:{p.floorSource}
              </span>
            </>
          )
        }
      >
        <div className="hero-num text-[30px] leading-none">{p ? sol(p.tip) : "—"}</div>
        <div className="mt-1.5 text-[11px] text-bone-faint">
          floor p50 {n ? sol(n.tipFloor) : "—"} SOL
        </div>
      </Tile>

      <Tile
        label="land rate · last 20"
        foot={
          <>
            <span className="tag-moss">{counts.landed} landed</span>
            <span className="tag-ghost">{counts.inFlight} live</span>
            <span className={counts.failed > 0 ? "tag-ember" : "tag-ghost"}>{counts.failed} failed</span>
          </>
        }
      >
        <div
          className={`hero-num text-[30px] leading-none ${
            landRate === null ? "" : landRate >= 66 ? "" : "!text-ember"
          }`}
        >
          {landRate === null ? "—" : `${landRate}%`}
        </div>
        {landRate !== null && (
          <div className="mt-2 h-1 w-full bg-line">
            <div
              className={`h-1 transition-[width] duration-700 ${landRate >= 66 ? "bg-moss" : "bg-ember"}`}
              style={{ width: `${landRate}%` }}
            />
          </div>
        )}
      </Tile>

      <Tile
        label="tip forecast · at landing"
        foot={
          p && (
            <>
              <span className="tag-ghost">vol {p.forecast.volatility.toFixed(2)}</span>
              <span className="tag-ghost">{sol(p.forecast.p50AtLanding)} @ landing</span>
            </>
          )
        }
      >
        <div className={`hero-num text-[30px] leading-none ${rising ? "!text-ember" : falling ? "!text-moss" : ""}`}>
          {trend === null ? "—" : `${rising ? "▲" : falling ? "▼" : "◆"} ${Math.abs(trend).toFixed(1)}%`}
        </div>
        <div className="mt-1.5 text-[11px] text-bone-faint">per 10 slots · holt(0.3/0.1)</div>
      </Tile>

      <Tile
        label="tip spend · session"
        foot={
          <>
            <span className="tag-ghost">{avgTip !== null ? `${sol(Math.round(avgTip))} avg / landed` : "no fills yet"}</span>
            {exposure > 0 && <span className="tag-gilt">{sol(exposure)} in flight</span>}
          </>
        }
      >
        <div className="hero-num text-[30px] leading-none">{sol(spent)}</div>
        <div className="mt-1.5 text-[11px] text-bone-faint">
          SOL paid in tips · failed bundles pay nothing
        </div>
      </Tile>

      <Tile label="stream race · first event wins">
        {two ? (
          <>
            {race.providers.map((pr, i) => {
              const share = totalWins > 0 ? pr.wins / totalWins : 0.5;
              return (
                <div key={pr.name} className="mb-2 last:mb-0">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] text-bone-dim">{orgLabel(pr.name)}</span>
                    <span className="text-[11px] tabular-nums text-bone-faint">
                      {Math.round(share * 100)}% · +{pr.p50DeltaMs}ms
                      {!pr.connected && <span className="ml-1 text-ember">✕</span>}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-line">
                    <div
                      className={`h-1.5 transition-[width] duration-700 ${i === 0 ? "bg-ember" : "bg-gilt"}`}
                      style={{ width: `${Math.max(2, share * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="mt-2 text-[10px] text-bone-faint">dropped {race.dropped}</div>
          </>
        ) : (
          <>
            <div className="hero-num text-[30px] leading-none">
              {race?.providers[0]?.connected ? "1×" : "—"}
            </div>
            <div className="mt-1.5 text-[11px] text-bone-faint">
              single feed{race?.providers[0] ? ` · ${orgLabel(race.providers[0].name)}` : ""} — set GRPC_URL_2 to
              race
            </div>
          </>
        )}
      </Tile>
    </div>
  );
}
