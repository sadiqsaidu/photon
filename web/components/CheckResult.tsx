"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { duration, isAddress, lamportsToUsd, number, showsProjection, sol, solscan, shortAddress, usd } from "@/lib/format";
import { onEvent } from "@/lib/live";
import type { Audit, AuditSummary, AuditTx } from "@/lib/types";
import { PrinterWaiting, Receipt, type Line } from "./Receipt";
import s from "./CheckResult.module.css";

const utc = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "UTC" });

const STRIP_MAX = 100;
const TABLE_MAX = 200;

type Verdict = "fair" | "above" | "low" | "unknown";

function verdictOf(t: AuditTx): Verdict {
  if (t.slotP50 === null || t.slotP25 === null) return "unknown";
  if (t.tip < t.slotP25) return "low";
  return t.tip > t.slotP50 ? "above" : "fair";
}

const VERDICT_WORD: Record<Verdict, string> = { fair: "Fair", above: "Above the going rate", low: "Too low", unknown: "No comparison" };

function sentence(sm: AuditSummary, price: number | null): string {
  const paid = usd(lamportsToUsd(sm.totalTipsLamports, price)) || sol(sm.totalTipsLamports);
  const over = usd(lamportsToUsd(sm.overpayLamports, price)) || sol(sm.overpayLamports);
  const low = sm.underpaidCount;
  const lowText = `${low} ${low === 1 ? "tip was" : "tips were"} too low to compete`;
  let out = `This wallet paid ${paid} in tips across ${number(sm.tipped)} ${sm.tipped === 1 ? "transaction" : "transactions"}.`;
  if (sm.overpayLamports > 0) out += ` About ${over} of that was above the going rate${low ? `, and ${lowText}.` : "."}`;
  else if (low) out += ` None of it was above the going rate, but ${lowText}.`;
  else out += " Every tip sat at or below the going rate of its block.";
  if (price === null) out += " Dollar figures are missing because the SOL price is not available right now.";
  return out;
}

function TradeStrip({ txs, price }: { txs: AuditTx[]; price: number | null }) {
  const [focus, setFocus] = useState<number | null>(null);
  const trades = useMemo(() => txs.filter((t) => t.tip > 0).slice(0, STRIP_MAX).reverse(), [txs]);
  const values = trades.flatMap((t) => [t.tip, t.slotP25 ?? t.tip, t.slotP75 ?? t.tip]).filter((v) => v > 0);
  const lo = Math.log10(Math.min(...values) * 0.8);
  const hi = Math.log10(Math.max(...values) * 1.25);
  const pos = (v: number) => `${100 - ((Math.log10(Math.max(v, 1)) - lo) / (hi - lo || 1)) * 100}%`;
  const active = focus === null ? null : trades[focus];
  return (
    <div className={s.stripWrap}>
      <div className={s.strip} aria-label={`${trades.length} trades, oldest first`} role="group">
        {trades.map((t, i) => {
          const v = verdictOf(t);
          return (
            <a
              key={t.signature}
              href={solscan(t.signature)}
              target="_blank"
              rel="noreferrer"
              className={s.trade}
              onMouseEnter={() => setFocus(i)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              aria-label={`Block ${number(t.slot)}: tipped ${usd(lamportsToUsd(t.tip, price)) || sol(t.tip)}, ${VERDICT_WORD[v]}. Opens Solscan.`}
            >
              {t.slotP25 !== null && t.slotP75 != null && (
                <span className={s.range} style={{ top: pos(t.slotP75), bottom: `calc(100% - ${pos(t.slotP25)})` }} />
              )}
              {t.slotP50 !== null && <span className={s.median} style={{ top: pos(t.slotP50) }} />}
              <span className={`${s.dot} ${s[v]}`} style={{ top: pos(t.tip) }} />
            </a>
          );
        })}
      </div>
      <div className={s.hover} aria-hidden="true">
        {active ? (
          <>
            <strong>{active.blockTime ? clock(active.blockTime * 1000) : "Time unknown"}</strong> in block {number(active.slot)}. Tipped{" "}
            {usd(lamportsToUsd(active.tip, price)) || sol(active.tip)}
            {active.slotP50 !== null && <>, going rate {usd(lamportsToUsd(active.slotP50, price)) || sol(active.slotP50)}</>}. {VERDICT_WORD[verdictOf(active)]}.
          </>
        ) : (
          "Point at a trade to see it. Click to open it on Solscan."
        )}
      </div>
      <div className={s.legend}>
        <span>
          <i className={`${s.key} ${s.fair}`} />
          Fair
        </span>
        <span>
          <i className={`${s.key} ${s.above}`} />
          Above the going rate
        </span>
        <span>
          <i className={`${s.key} ${s.low}`} />
          Too low to compete
        </span>
        <span>
          <i className={s.keyRange} />
          The block&apos;s fair range, with its going rate
        </span>
      </div>
    </div>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 429) return `Too many checkups from your connection. Try again in ${e.body.retryAfterSec ?? 60} seconds.`;
  if (e instanceof ApiError && e.status === 0) return e.message;
  return "This wallet could not be checked right now. The network may be slow; try again in a moment.";
}

export function CheckResult({ address }: { address: string }) {
  const valid = isAddress(address);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{ at: number; tx: AuditTx }[]>([]);
  const [watching, setWatching] = useState<"off" | "starting" | "on">("off");
  const [copied, setCopied] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const printed = useRef(false);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    setError(null);
    api
      .audit(address)
      .then((a) => {
        if (!alive) return;
        setAudit(a);
        if (a.watching) setWatching("on");
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [address, valid, attempt]);

  useEffect(() => {
    if (watching !== "on") return;
    return onEvent("audit", (data) => {
      const ev = data as { address: string; tx: AuditTx; summary: AuditSummary };
      if (ev.address !== address) return;
      setLive((l) => [...l, { at: Date.now(), tx: ev.tx }].slice(-6));
      setAudit((a) => (a ? { ...a, summary: { ...a.summary, ...ev.summary }, txs: [ev.tx, ...a.txs.filter((t) => t.signature !== ev.tx.signature)] } : a));
    });
  }, [watching, address]);

  if (!valid)
    return (
      <div className={s.center}>
        <h1 className="h2">That is not a Solana wallet address.</h1>
        <p className="muted">
          It should be 32 to 44 letters and numbers. <Link href="/check">Try another wallet</Link>
        </p>
      </div>
    );

  if (error)
    return (
      <div className={s.center}>
        <PrinterWaiting>
          <p className="error">{error}</p>
          <button className="btn" type="button" onClick={() => setAttempt((n) => n + 1)} style={{ marginTop: 16 }}>
            Try again
          </button>
        </PrinterWaiting>
      </div>
    );

  if (!audit)
    return (
      <div className={s.center}>
        <PrinterWaiting>
          Looking up the last 100 transactions of <span className="mono">{shortAddress(address)}</span> and the tips in each block. This takes 5 to 20
          seconds.
        </PrinterWaiting>
      </div>
    );

  const sm = audit.summary;
  const price = audit.solPriceUsd;
  const money = (lamports: number) => usd(lamportsToUsd(lamports, price)) || sol(lamports);
  const span = sm.periodFrom !== null && sm.periodTo !== null ? sm.periodTo - sm.periodFrom : null;
  const lines: Line[] = [
    { kind: "item", label: "Wallet", value: shortAddress(address) },
    { kind: "item", label: "Period", value: span === null ? "none" : `last ${duration(Math.max(span, 1))}` },
    { kind: "item", label: "Transactions with a tip", value: `${number(sm.tipped)} of ${number(sm.analyzed)}` },
    { kind: "rule" },
    { kind: "item", label: "Tips paid", value: money(sm.totalTipsLamports) },
    ...(price ? [{ kind: "sub" as const, value: sol(sm.totalTipsLamports) }] : []),
    { kind: "item", label: "Going rate, same blocks", value: money(sm.goingRateLamports) },
    { kind: "item", label: "Paid above going rate", value: money(sm.overpayLamports), strong: true },
    { kind: "item", label: "Too low to compete", value: `${sm.underpaidCount} ${sm.underpaidCount === 1 ? "tip" : "tips"}` },
  ];
  if (showsProjection(sm) && sm.monthlyOverpayLamports !== null) {
    lines.push(
      { kind: "rule" },
      { kind: "text", value: "At this pace, about" },
      { kind: "text", value: `${money(sm.monthlyOverpayLamports)} a month`, big: true },
      { kind: "text", value: "above the going rate (projection)", muted: true },
    );
  }
  if (live.length) {
    lines.push({ kind: "rule" });
    for (const l of live) lines.push({ kind: "item", label: `${clock(l.at)} new trade`, value: l.tx.tip ? money(l.tx.tip) : "no tip", tone: "live" });
  }
  const empty = sm.tipped === 0;
  const first = !printed.current;
  printed.current = true;

  const watch = () => {
    setWatching("starting");
    setWatchError(null);
    api.watch(address).then(
      () => setWatching("on"),
      (e) => {
        setWatching("off");
        setWatchError(e instanceof ApiError && e.status === 429 ? "Too many watch requests from your connection. Try again in a minute." : "Live watching could not start right now. Try again in a moment.");
      },
    );
  };
  const copy = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    });
  };

  return (
    <div className={s.layout}>
      <div className={s.left}>
        <Receipt
          label="Wallet checkup receipt"
          title="Tipwise wallet checkup"
          meta={utc(audit.updatedAt)}
          lines={empty ? [{ kind: "item", label: "Wallet", value: shortAddress(address) }, { kind: "item", label: "Transactions checked", value: number(sm.analyzed) }, { kind: "rule" }, { kind: "text", value: "No tips found." }] : lines}
          stamp={empty ? null : sm.stamp}
          print={first}
          footer={`${window.location.host}/check/${shortAddress(address)}`}
        />
      </div>
      <div className={s.right}>
        <p className={s.crumb}>
          Wallet <span className="mono">{address}</span>
        </p>
        {empty ? (
          <p className={s.summary}>No tips in the last {number(sm.analyzed)} transactions. This wallet does not pay tips through Jito or Beam.</p>
        ) : (
          <>
            <p className={s.summary}>{sentence(sm, price)}</p>
            <details className={s.how}>
              <summary>How we measure this</summary>
              <p>
                The going rate is the median tip that landed in the same block. A tip above it counts as above the going rate, and the difference is our
                estimate of the overpay: a smaller tip might still have landed, but nobody can know for sure. A tip below the cheapest quarter of tips in
                that block counts as too low to compete.
              </p>
            </details>
            <h2 className={`h3 ${s.stripTitle}`}>Trade by trade</h2>
            <p className="small muted">Each grey bar is the fair range of tips in that block. The dot is what this wallet paid.</p>
            <TradeStrip txs={audit.txs} price={price} />
          </>
        )}
        <div className={s.actions}>
          {watching === "on" ? (
            <span className={s.watching}>
              <span className={s.liveDot} aria-hidden="true" />
              Watching live for 15 minutes. New trades print on the receipt.
            </span>
          ) : (
            <button className="btn primary" type="button" onClick={watch} disabled={watching === "starting"}>
              {watching === "starting" ? "Starting" : "Watch this wallet live"}
            </button>
          )}
          <button className="btn" type="button" onClick={copy}>
            {copied ? "Link copied" : "Copy link"}
          </button>
          <Link className="btn" href="/developers">
            Fix this in your bot
          </Link>
        </div>
        {watchError && (
          <p className="error" role="alert">
            {watchError}
          </p>
        )}
        {!empty && (
          <details className={s.table}>
            <summary>Show every transaction</summary>
            <div className={s.scroll}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Time (UTC)</th>
                    <th scope="col">Tip</th>
                    <th scope="col">Going rate</th>
                    <th scope="col">Above it</th>
                    <th scope="col">Verdict</th>
                    <th scope="col">
                      <span className="sr-only">Link</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audit.txs
                    .filter((t) => t.tip > 0)
                    .slice(0, TABLE_MAX)
                    .map((t) => (
                      <tr key={t.signature}>
                        <td>{t.blockTime ? clock(t.blockTime * 1000) : ""}</td>
                        <td>
                          {money(t.tip)}
                          {price ? <span className={s.solCell}>{sol(t.tip)}</span> : null}
                        </td>
                        <td>{t.slotP50 === null ? "" : money(t.slotP50)}</td>
                        <td>{t.overpay ? money(t.overpay) : ""}</td>
                        <td>{VERDICT_WORD[verdictOf(t)]}</td>
                        <td>
                          <a href={solscan(t.signature)} target="_blank" rel="noreferrer">
                            Solscan
                          </a>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
