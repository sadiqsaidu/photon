"use client";

import { useEffect, useState } from "react";
import { getJson, lamports, pct, sol } from "@/lib/format";

interface Quote {
  deadlineSlots: number;
  confidence: number;
  tipLamports: number;
  priorityFeeMicroLamports: number;
  probability: number;
  meetsConfidence: boolean;
  calibrated: boolean;
  bucket: { lo: number; hi: number };
  distribution: { source: string; samples: number; beamFloorPercentile: number };
  heatMultiplier: number;
}

const CONFIDENCES = [0.8, 0.9, 0.95, 0.99];

export function QuoteWidget() {
  const [deadline, setDeadline] = useState(2);
  const [confidence, setConfidence] = useState(0.9);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getJson<Quote>(`/quote?deadline=${deadline}&confidence=${confidence}`)
        .then((q) => alive && (setQuote(q), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const timer = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [deadline, confidence]);

  return (
    <section className="panel">
      <div className="title">
        <span className="label">live quote</span>
        {quote && <span className={`tag ${quote.calibrated ? "good" : "warn"}`}>{quote.calibrated ? "calibrated" : "priors, not calibrated"}</span>}
      </div>
      <div className="grid-2" style={{ alignItems: "end" }}>
        <div>
          <div className="hero-num">{quote ? lamports(quote.tipLamports) : "-"}</div>
          <div className="muted">
            lamports tip {quote ? `(${sol(quote.tipLamports)} SOL)` : ""}, priority fee {quote ? lamports(quote.priorityFeeMicroLamports) : "-"} micro-lamports/CU
          </div>
          <div style={{ marginTop: 8 }}>
            P(land within {deadline} slot{deadline > 1 ? "s" : ""}) <b className="num">{quote ? pct(quote.probability, 1) : "-"}</b>{" "}
            {quote && !quote.meetsConfidence && <span className="tag bad">below requested confidence</span>}
          </div>
          {error && <div className="tag bad" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <label>
            <div className="label">deadline: {deadline} slot{deadline > 1 ? "s" : ""}</div>
            <input type="range" min={1} max={10} value={deadline} onChange={(e) => setDeadline(Number(e.target.value))} />
          </label>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>confidence</div>
            <div className="seg" role="group" aria-label="confidence">
              {CONFIDENCES.map((c) => (
                <button key={c} aria-pressed={c === confidence} onClick={() => setConfidence(c)}>
                  {c * 100}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {quote && (
        <div className="faint" style={{ marginTop: 10, fontSize: 11 }}>
          priced in bucket p{quote.bucket.lo}-{quote.bucket.hi} of {quote.distribution.samples.toLocaleString("en-US")} landed tips at or above the
          Beam floor ({quote.distribution.source}); the 100,000 lamport floor sits at p{quote.distribution.beamFloorPercentile} of all landed tips.
          {quote.heatMultiplier !== 1 && ` Heat multiplier ${quote.heatMultiplier.toFixed(2)}.`}
        </div>
      )}
    </section>
  );
}
