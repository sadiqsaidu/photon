"use client";

import { useEffect, useState } from "react";
import { useLeaders } from "./leaders-context";
import { useStore } from "@/lib/store";
import type { JitoWindowRow } from "@/lib/api";

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 5)}…${id.slice(-5)}` : id;
}

function stakeSol(lamports: number | undefined): string {
  if (!lamports) return "—";
  const solAmt = lamports / 1e9;
  if (solAmt >= 1e6) return `${(solAmt / 1e6).toFixed(2)}M`;
  if (solAmt >= 1e3) return `${(solAmt / 1e3).toFixed(1)}k`;
  return solAmt.toFixed(0);
}

function eta(ms: number): string {
  if (ms <= 0) return "now";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function Detail({ w, onClose }: { w: JitoWindowRow; onClose: () => void }) {
  const v = w.validator;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/60" onClick={onClose} />
      <aside className="rise-in fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col border-l border-gilt-dim bg-coal-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gilt">jito validator</span>
          <button onClick={onClose} className="text-bone-faint hover:text-bone">
            ✕
          </button>
        </div>
        <div className="hero-num break-all text-[15px] leading-snug">{w.identity}</div>
        <div className="mt-5 space-y-2.5 text-[11px]">
          <Row k="window slots" v={`${w.start.toLocaleString()} – ${w.end.toLocaleString()}`} />
          <Row k="slots away" v={w.slotsAway > 0 ? String(w.slotsAway) : "open now"} />
          <Row k="vote account" v={v ? shortId(v.votePubkey) : "—"} mono />
          <Row k="active stake" v={v ? `${stakeSol(v.activatedStake)} SOL` : "—"} />
          <Row k="commission" v={v ? `${v.commission}%` : "—"} />
          <Row k="mev commission" v={v?.mevCommissionBps != null ? `${(v.mevCommissionBps / 100).toFixed(2)}%` : "—"} />
          <Row k="client" v={v?.runningJito === false ? "not jito?" : "jito-solana"} />
        </div>
        <div className="mt-6 space-y-2">
          <a
            href={`https://solscan.io/account/${w.identity}`}
            target="_blank"
            rel="noreferrer"
            className="block border border-line px-3 py-2 text-center text-[11px] uppercase tracking-widest text-bone-dim hover:border-gilt hover:text-gilt"
          >
            identity on solscan ↗
          </a>
          {v && (
            <a
              href={`https://solscan.io/account/${v.votePubkey}`}
              target="_blank"
              rel="noreferrer"
              className="block border border-line px-3 py-2 text-center text-[11px] uppercase tracking-widest text-bone-dim hover:border-gilt hover:text-gilt"
            >
              vote account on solscan ↗
            </a>
          )}
        </div>
        <p className="mt-auto text-[10px] leading-relaxed text-bone-faint">
          bundles fired now are routed to this leader's window. higher stake ⇒ more scheduled slots; mev commission
          is the cut this validator takes from tips.
        </p>
      </aside>
    </>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-bone-faint">{k}</span>
      <span className={`text-right text-bone-dim ${mono ? "break-all" : ""} tabular-nums`}>{v}</span>
    </div>
  );
}

// The searcher's firing schedule: the next 10 Jito leader windows, counting
// down live. Click a row for the validator behind it.
export function JitoWindows() {
  const { leaders } = useLeaders();
  const { state } = useStore();
  const [selected, setSelected] = useState<JitoWindowRow | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500); // tick the countdowns
    return () => clearInterval(id);
  }, []);

  const liveSlot = Math.max(state.slot, leaders?.currentSlot ?? 0);
  const slotMs = leaders?.slotMs || 400;
  const rows = (leaders?.windows ?? []).filter((w) => w.end >= liveSlot);

  return (
    <div className="panel flex-1">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="label">jito windows · next 10 · click a row for the validator</span>
        <span className="text-[10px] tabular-nums text-bone-faint">slot {liveSlot > 0 ? liveSlot.toLocaleString() : "—"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[11px] text-bone-ghost">
          deriving windows — needs the leader schedule + validator set (seconds after boot)
        </div>
      ) : (
        <table className="mt-2 w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-widest text-bone-ghost">
              <th className="py-1 pl-4 font-normal">eta</th>
              <th className="font-normal">slots</th>
              <th className="font-normal">validator</th>
              <th className="font-normal">stake</th>
              <th className="pr-4 text-right font-normal">mev fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => {
              const remaining = w.start - liveSlot;
              const open = remaining <= 0;
              const ms = remaining * slotMs;
              return (
                <tr
                  key={w.start}
                  onClick={() => setSelected(w)}
                  className={`cursor-pointer border-t border-line/60 transition-colors hover:bg-coal-raise ${
                    i === 0 ? "bg-coal-raise/60" : ""
                  }`}
                >
                  <td className={`py-1.5 pl-4 tabular-nums ${open ? "font-bold text-moss" : i === 0 ? "text-gilt" : "text-bone-dim"}`}>
                    {open ? "● OPEN" : eta(ms)}
                  </td>
                  <td className="tabular-nums text-bone-faint">
                    {w.start.toLocaleString()}–{String(w.end).slice(-2)}
                  </td>
                  <td className="text-bone-dim">{shortId(w.identity)}</td>
                  <td className="tabular-nums text-bone-faint">{stakeSol(w.validator?.activatedStake)}</td>
                  <td className="pr-4 text-right tabular-nums text-bone-faint">
                    {w.validator?.mevCommissionBps != null ? `${(w.validator.mevCommissionBps / 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {selected && <Detail w={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
