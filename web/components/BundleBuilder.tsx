"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { prepareBundle, submitBundle } from "@/lib/api";
import { useStore } from "@/lib/store";
import { base64ToBytes, bytesToBase64, sol } from "@/lib/format";

type Mode = "transfer" | "raw";

export function BundleBuilder() {
  const { publicKey, signTransaction } = useWallet();
  const { state } = useStore();
  const suggested = state.tipPolicy?.tip ?? 10_000;

  const [mode, setMode] = useState<Mode>("transfer");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [tip, setTip] = useState(suggested);
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState("");

  async function submitTransfer() {
    if (!publicKey || !signTransaction) return setStatus("connect a wallet first");
    try {
      const lamports = Math.round(parseFloat(amount) * 1e9);
      setStatus("preparing…");
      const prep = await prepareBundle(publicKey.toBase58(), tip, { kind: "sol_transfer", to, lamports });
      const tx = new VersionedTransaction(VersionedMessage.deserialize(base64ToBytes(prep.messageBase64)));
      setStatus("awaiting signature…");
      const signed = await signTransaction(tx);
      const signature = bs58.encode(signed.signatures[0]);
      setStatus("submitting…");
      const res = await submitBundle([bytesToBase64(signed.serialize())], signature, prep.tip);
      setStatus(res.bundleId ? `submitted · ${res.bundleId.slice(0, 10)}…` : "submitted");
    } catch (e) {
      setStatus(`error · ${String(e)}`);
    }
  }

  async function submitRaw() {
    try {
      const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
      if (lines.length === 0) return setStatus("paste at least one base64 transaction");
      const first = VersionedTransaction.deserialize(base64ToBytes(lines[0] as string));
      const signature = bs58.encode(first.signatures[0] as Uint8Array);
      setStatus("submitting bundle…");
      const res = await submitBundle(lines, signature, 0);
      setStatus(res.bundleId ? `submitted · ${res.bundleId.slice(0, 10)}…` : "submitted");
    } catch (e) {
      setStatus(`error · ${String(e)}`);
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">build bundle</span>
        <div className="flex gap-1 text-[11px]">
          {(["transfer", "raw"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-1 ${mode === m ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500"}`}
            >
              {m === "transfer" ? "SOL transfer" : "raw / advanced"}
            </button>
          ))}
        </div>
      </div>

      {mode === "transfer" ? (
        <div className="space-y-2.5">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient address"
            className="num w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-accent/40"
          />
          <div className="flex gap-2.5">
            <label className="flex-1">
              <span className="text-[10px] text-zinc-500">amount (SOL)</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="num mt-1 w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-accent/40"
              />
            </label>
            <label className="flex-1">
              <span className="text-[10px] text-zinc-500">tip (lamports)</span>
              <input
                value={tip}
                onChange={(e) => setTip(Number(e.target.value) || 0)}
                className="num mt-1 w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-accent/40"
              />
            </label>
          </div>
          <button onClick={() => setTip(suggested)} className="text-[11px] text-accent hover:underline">
            use AI tip · {sol(suggested)} SOL
          </button>
        </div>
      ) : (
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="paste base64 signed transactions, one per line"
          rows={4}
          className="num w-full resize-none rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-accent/40"
        />
      )}

      <button
        onClick={mode === "transfer" ? submitTransfer : submitRaw}
        className="mt-3 w-full rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5 text-[13px] font-medium text-accent hover:bg-accent/20"
      >
        {publicKey || mode === "raw" ? "Submit bundle" : "Connect wallet to submit"}
      </button>
      {status && <div className="num mt-2 break-all text-[11px] text-zinc-500">{status}</div>}
    </div>
  );
}
