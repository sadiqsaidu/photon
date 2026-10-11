"use client";

import { useState } from "react";
import { blocks, lamportsToUsd, number, pct, seconds, shortAddress, sol, solscan, usd } from "@/lib/format";
import type { Receipt as R } from "@/lib/types";
import { Receipt, type Line } from "./Receipt";
import s from "./Ticket.module.css";

const KIND = { demo: "Free test, paid by Tipwise", sdk: "Sent through the Tipwise API", probe: "Tipwise test trip" };
const FARE = { saver: "Saver", standard: "Standard", express: "Express" };
const REGION: Record<string, string> = { ams: "Amsterdam", fra: "Frankfurt", nyc: "New York", sgp: "Singapore", tyo: "Tokyo", lax: "Los Angeles" };

export function landedIn(r: R): { blocks: number; ms: number } | null {
  if (r.landedSlot === null) return null;
  const n = Math.max(1, r.landedSlot - r.sentSlot);
  return { blocks: n, ms: r.stages.processed?.ms ?? r.stages.confirmed?.ms ?? n * 400 };
}

export function ticketLines(r: R, price: number | null): Line[] {
  const money = (l: number) => usd(lamportsToUsd(l, price)) || sol(l);
  const land = landedIn(r);
  const lines: Line[] = [
    { kind: "item", label: "Fare", value: r.fare ? FARE[r.fare] : "No fare" },
    { kind: "item", label: "Sent by", value: r.kind === "demo" ? "Tipwise" : r.kind === "probe" ? "Tipwise" : "Your wallet" },
    { kind: "item", label: "Tip", value: money(r.tip) },
  ];
  if (price) lines.push({ kind: "sub", value: sol(r.tip) });
  lines.push({ kind: "item", label: "Sent in block", value: number(r.sentSlot) });
  lines.push({ kind: "item", label: "Landed in block", value: r.landedSlot === null ? "none" : number(r.landedSlot) });
  if (land && r.failure !== "failed_onchain") lines.push({ kind: "item", label: "Took", value: `${blocks(land.blocks)} (${seconds(land.ms)})`, strong: true });
  if (r.deadlineSlots !== null && r.quotedProbability !== null) {
    const kept = land !== null && r.failure === null && land.blocks <= r.deadlineSlots;
    lines.push(
      { kind: "rule" },
      { kind: "item", label: "Promise", value: `${pct(r.quotedProbability)} within ${r.deadlineSlots}` },
      { kind: "item", label: "Promise kept", value: r.settled || land ? (kept ? "yes" : "no") : "pending" },
    );
  }
  lines.push({ kind: "rule" });
  if (r.beam) {
    lines.push({ kind: "item", label: "Route", value: `Beam, ${REGION[r.beam.region] ?? r.beam.region}` });
    lines.push({ kind: "item", label: "Through Jito", value: r.beam.landed_via_jito ? "yes" : "no" });
  } else lines.push({ kind: "item", label: "Route", value: r.settled ? "Beam" : "Beam, record pending" });
  lines.push({ kind: "item", label: "Signature", value: shortAddress(r.signature, 6) });
  return lines;
}

export function Explanation({ receipt }: { receipt: R }) {
  const e = receipt.explanation;
  if (!e) return null;
  return (
    <div className={s.explain}>
      <p className={s.title}>{e.title}</p>
      <dl>
        <dt>What happened</dt>
        <dd>{e.whatHappened}</dd>
        <dt>What to do</dt>
        <dd>{e.whatToDo}</dd>
      </dl>
    </div>
  );
}

export function TicketActions({ receipt }: { receipt: R }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/receipt/${receipt.signature}`;
  return (
    <div className={s.actions}>
      <a className="btn primary" href={solscan(receipt.signature)} target="_blank" rel="noreferrer">
        View on Solscan
      </a>
      <button
        type="button"
        className="btn"
        onClick={() =>
          navigator.clipboard?.writeText(link).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2_000);
          })
        }
      >
        {copied ? "Link copied" : "Copy receipt link"}
      </button>
    </div>
  );
}

export function Ticket({ receipt, price, print = true }: { receipt: R; price: number | null; print?: boolean }) {
  const stamp = receipt.failure ? "missed" : receipt.landedSlot !== null ? "landed" : null;
  return (
    <Receipt
      label="Send ticket"
      title="Tipwise ticket"
      meta={`${KIND[receipt.kind]}. ${new Date(receipt.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })} UTC`}
      lines={ticketLines(receipt, price)}
      stamp={receipt.settled ? stamp : null}
      print={print}
    />
  );
}
