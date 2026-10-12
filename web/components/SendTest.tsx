"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { blocks, lamportsToUsd, seconds, sol, usd } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { FareId, Receipt } from "@/lib/types";
import { FarePicker } from "./FarePicker";
import { Journey } from "./Journey";
import { Explanation, landedIn, Ticket, TicketActions } from "./Ticket";
import s from "./SendTest.module.css";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const CU_LIMIT = 20_000;
const BASE_FEE = 5_000;

type Limit = { reason: string; until: number | null };

function useTracked(signature: string | null): Receipt | null {
  const fromStream = useLive((st) => (signature ? st.receipts.find((r) => r.signature === signature) ?? null : null));
  const [polled, setPolled] = useState<Receipt | null>(null);
  useEffect(() => {
    setPolled(null);
    if (!signature) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      api
        .receipt(signature)
        .then((r) => {
          if (!alive) return;
          setPolled(r);
          if (!r.settled) timer = setTimeout(poll, 1_000);
        })
        .catch(() => alive && (timer = setTimeout(poll, 1_000)));
    timer = setTimeout(poll, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [signature]);
  const score = (r: Receipt | null) => (r ? (r.settled ? 100 : 0) + Object.keys(r.stages).length + (r.failure ? 10 : 0) : -1);
  return score(fromStream) >= score(polled) ? fromStream : polled;
}

function limitText(l: Limit, now: number): string {
  const left = l.until === null ? null : Math.max(0, Math.ceil((l.until - now) / 1000));
  if (l.reason === "cooldown") return left ? `Someone just sent a test. Yours can go in ${left} s.` : "You can send now.";
  if (l.reason === "ip") return left ? `You sent a test a moment ago. The next one can go in ${left} s.` : "You can send now.";
  if (l.reason === "daily") return "Today's free tests are used up. Send from your wallet instead, it costs about $0.02.";
  if (l.reason === "budget") return "Free tests are paused for now. Send from your wallet instead, it costs about $0.02.";
  if (l.reason === "disabled") return "Free tests are not switched on for this server. Send from your wallet instead.";
  return "Free tests are not available right now. Try again in a moment.";
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
}

export function SendTest() {
  const fares = useLive((st) => st.fares);
  const price = useLive((st) => st.solPrice);
  const { publicKey, signTransaction, wallets, wallet } = useWallet();
  const [fare, setFare] = useState<FareId>("standard");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState<"demo" | "wallet" | null>(null);
  const [limit, setLimit] = useState<Limit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isMobile, setIsMobile] = useState(false);
  const receipt = useTracked(signature);
  const resultRef = useRef<HTMLDivElement>(null);
  const chosen = fares?.fares.find((f) => f.id === fare) ?? null;

  useEffect(() => setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)), []);
  useEffect(() => {
    if (!limit?.until) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [limit]);
  useEffect(() => {
    if (limit?.until && now >= limit.until) setLimit(null);
  }, [now, limit]);

  const started = (sig: string) => {
    setSignature(sig);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const sendForMe = async () => {
    setBusy("demo");
    setError(null);
    try {
      const out = await api.demo(fare);
      started(out.signature);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 429 || e.status === 503)) {
        const sec = typeof e.body.retryAfterSec === "number" ? e.body.retryAfterSec : null;
        setLimit({ reason: String(e.body.reason ?? "other"), until: sec === null ? null : Date.now() + sec * 1000 });
        setNow(Date.now());
      } else setError(e instanceof Error ? e.message : "The test could not be sent.");
    } finally {
      setBusy(null);
    }
  };

  const sendFromWallet = async () => {
    if (!publicKey || !signTransaction || !chosen) return;
    setBusy("wallet");
    setError(null);
    try {
      const [{ blockhash }, { beam }] = await Promise.all([api.blockhash(), api.tipAddresses()]);
      const to = new PublicKey(beam[Math.floor(Math.random() * beam.length)] as string);
      const message = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: chosen.priorityFeeMicroLamports }),
          new TransactionInstruction({ programId: MEMO, keys: [], data: new TextEncoder().encode("tipwise-test") as never }),
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: to, lamports: chosen.tipLamports }),
        ],
      }).compileToV0Message();
      const signed = await signTransaction(new VersionedTransaction(message));
      const out = await api.send(toBase64(signed.serialize()), fare);
      started(out.signature);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(msg) ? "You cancelled the signature in your wallet. Nothing was sent." : `The send did not go through: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const walletCost = chosen ? chosen.tipLamports + BASE_FEE + Math.ceil((chosen.priorityFeeMicroLamports * CU_LIMIT) / 1_000_000) : null;
  const noInjected = !wallets.some((w) => w.readyState === "Installed");
  const land = receipt ? landedIn(receipt) : null;

  return (
    <div className={s.page}>
      <section className={s.intro}>
        <h1 className="h1">Send a real transaction and watch it land.</h1>
        <p className="lede">
          Pick a fare. Tipwise sends a small transaction to the Solana mainnet through Solami Beam with that tip, follows it block by block, and prints
          you a ticket.
        </p>
      </section>

      <section aria-labelledby="fare-title" className={s.step}>
        <h2 id="fare-title" className="h3">
          Fare
        </h2>
        <FarePicker fares={fares?.fares ?? null} value={fare} onChange={setFare} />
        <p className="small muted" style={{ marginTop: 12 }}>
          Prices come from where landed tips sit today; chances come from Tipwise&apos;s test trips. A higher tip buys position in crowded blocks but does
          not guarantee an earlier one.
        </p>
      </section>

      <section className={s.choices} aria-label="How to send">
        <div className={s.primary}>
          <button type="button" className="btn primary" onClick={sendForMe} disabled={busy !== null || !chosen || Boolean(limit?.until && now < limit.until)}>
            {busy === "demo" ? "Sending" : "Send a test for me"}
          </button>
          <p className="small muted">Free. Tipwise pays the tip from its own wallet.</p>
          {limit && (
            <p className={s.limit} role="status">
              {limitText(limit, now)}
            </p>
          )}
        </div>
        <div className={s.secondary}>
          {publicKey ? (
            <>
              <button type="button" className="btn" onClick={sendFromWallet} disabled={busy !== null || !chosen}>
                {busy === "wallet" ? "Waiting for your wallet" : "Send from my wallet"}
              </button>
              <p className="small muted">
                {walletCost !== null
                  ? `Costs about ${sol(walletCost)}${price ? ` (${usd(lamportsToUsd(walletCost, price))})` : ""}: a tip plus the network fee. Nothing else leaves your wallet${wallet ? ` (${wallet.adapter.name})` : ""}.`
                  : "Waiting for the live fare."}
              </p>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled>
                Send from my wallet
              </button>
              <p className="small muted">
                {isMobile && noInjected
                  ? "Open this page in your wallet's browser to send from your wallet."
                  : "Connect a wallet first, with the button at the top of the page."}
              </p>
            </>
          )}
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div ref={resultRef} className={s.result} aria-live="polite">
        {signature && (
          <>
            <h2 className="h2">{land && !receipt?.failure ? `Landed in ${blocks(land.blocks)} (${seconds(land.ms)})` : receipt?.failure ? "It did not land." : "On its way"}</h2>
            <Journey receipt={receipt} />
            {receipt?.settled ? (
              <div className={s.settled}>
                <div className={s.ticket}>
                  <Ticket receipt={receipt} price={price} />
                </div>
                <div className={s.words}>
                  <Explanation receipt={receipt} />
                  <TicketActions receipt={receipt} />
                  <p className="small muted" style={{ marginTop: 20 }}>
                    Want this in your own bot? <Link href="/developers">See the developer guide</Link>.
                  </p>
                </div>
              </div>
            ) : (
              <p className="small muted">The ticket prints when the transaction is final, usually about 13 seconds after it lands.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
