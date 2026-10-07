"use client";

import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { useEvent, useLive } from "@/lib/events";
import { getJson, lamports, short, sol, solscanTx } from "@/lib/format";

interface AuditTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  success: boolean;
  tip: number;
  priorityFee: number;
  slotP25: number | null;
  slotP50: number | null;
  overpay: number;
  underpaid: boolean;
}

interface Summary {
  analyzed: number;
  tipped: number;
  benchmarked: number;
  totalTipsLamports: number;
  overpayLamports: number;
  overpaySol: number;
  overpayUsd: number | null;
  underpaidCount: number;
  worst: AuditTx[];
}

interface Audit {
  address: string;
  limit: number;
  historySource: string;
  blocksFetched: number;
  solPriceUsd: number | null;
  watching: boolean;
  updatedAt: number;
  summary: Summary;
  txs: AuditTx[];
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel">
      <div className="label">{label}</div>
      <div className="hero-num" style={{ fontSize: 26 }}>
        {value}
      </div>
      {sub && <div className="muted">{sub}</div>}
    </div>
  );
}

export default function AuditPage() {
  const live = useLive();
  const [address, setAddress] = useState("");
  const [limit, setLimit] = useState(100);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEvent<{ address: string; tx: AuditTx; summary: Summary }>("audit", (ev) => {
    setAudit((a) => (a && a.address === ev.address && !a.txs.some((t) => t.signature === ev.tx.signature) ? { ...a, summary: ev.summary, txs: [ev.tx, ...a.txs].slice(0, 1000) } : a));
  });

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setAudit(await getJson<Audit>("/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: address.trim(), limit }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const watch = async () => {
    if (!audit) return;
    try {
      await getJson(`/audit/${audit.address}/watch`, { method: "POST" });
      setAudit({ ...audit, watching: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const s = audit?.summary;
  const tipped = (audit?.txs ?? []).filter((t) => t.tip > 0);
  const rows = showAll ? audit?.txs ?? [] : tipped;

  return (
    <main className="shell">
      <TopBar live={live} />
      <section className="panel">
        <div className="title">
          <span className="label">tip audit</span>
          <span className="faint" style={{ fontSize: 11 }}>overpay is an estimate against each slot&apos;s median landed tip</span>
        </div>
        <form
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input type="text" placeholder="wallet address" value={address} onChange={(e) => setAddress(e.target.value)} style={{ flex: "1 1 320px" }} aria-label="wallet address" />
          <input type="number" min={1} max={300} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 90 }} aria-label="transactions to analyze" />
          <button className="button" disabled={busy || !address.trim()}>
            {busy ? "auditing..." : "audit"}
          </button>
          {audit && (
            <button type="button" className="button" onClick={watch} disabled={audit.watching}>
              {audit.watching ? "watching live" : "watch live"}
            </button>
          )}
        </form>
        {error && <p className="tag bad" style={{ marginTop: 10 }}>{error}</p>}
      </section>

      {audit && s && (
        <>
          <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <Card label="tips paid" value={`${sol(s.totalTipsLamports)} SOL`} sub={`${s.tipped} of ${s.analyzed} transactions tipped`} />
            <Card
              label="estimated overpay"
              value={`${sol(s.overpayLamports)} SOL`}
              sub={s.overpayUsd === null ? "no SOL price available" : `about $${s.overpayUsd.toFixed(2)} at $${audit.solPriceUsd?.toFixed(2)}/SOL`}
            />
            <Card label="underpaid" value={String(s.underpaidCount)} sub="tip below the slot's p25" />
            <Card label="benchmarked" value={`${s.benchmarked} / ${s.tipped}`} sub={`${audit.blocksFetched} blocks fetched, history via ${audit.historySource}`} />
          </div>
          <section className="panel">
            <div className="title">
              <span className="label">{showAll ? "all transactions" : "tipped transactions"}</span>
              <button type="button" className="button" style={{ padding: "3px 10px" }} onClick={() => setShowAll(!showAll)}>
                {showAll ? "show tipped only" : "show all"}
              </button>
            </div>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>signature</th>
                    <th className="r">slot</th>
                    <th className="r">tip</th>
                    <th className="r">slot p25</th>
                    <th className="r">slot p50</th>
                    <th className="r">overpay</th>
                    <th className="r">priority fee</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 300).map((t) => (
                    <tr key={t.signature}>
                      <td>
                        <a href={solscanTx(t.signature)} target="_blank" rel="noreferrer">
                          {short(t.signature, 8, 6)}
                        </a>
                      </td>
                      <td className="r">{t.slot.toLocaleString("en-US")}</td>
                      <td className="r">{lamports(t.tip)}</td>
                      <td className="r">{lamports(t.slotP25)}</td>
                      <td className="r">{lamports(t.slotP50)}</td>
                      <td className="r">{t.overpay ? lamports(t.overpay) : "-"}</td>
                      <td className="r">{lamports(t.priorityFee)}</td>
                      <td>
                        {!t.success ? <span className="tag bad">failed</span> : t.underpaid ? <span className="tag warn">underpaid</span> : t.tip > 0 && t.slotP50 === null ? <span className="tag">no benchmark</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="muted">No tipped transactions in this window.</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
