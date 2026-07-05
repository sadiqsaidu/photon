"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { prepareBundle, submitBundle } from "@/lib/api";
import { useStore } from "@/lib/store";
import { base64ToBytes, bytesToBase64, sol } from "@/lib/format";

type Mode = "transfer" | "raw";

export function BuildDock() {
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
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">launch</span>
        <div className="flex gap-px">
          {(["transfer", "raw"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                mode === m ? "border-bone-faint bg-coal-raise text-bone" : "border-line text-bone-faint hover:text-bone-dim"
              }`}
            >
              {m === "transfer" ? "sol" : "raw"}
            </button>
          ))}
        </div>
      </div>

      {mode === "transfer" ? (
        <div className="space-y-2">
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient address" className="field" />
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-[9px] uppercase tracking-widest text-bone-faint">amount sol</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} className="field mt-1" />
            </label>
            <label className="flex-1">
              <span className="text-[9px] uppercase tracking-widest text-bone-faint">tip lamports</span>
              <input value={tip} onChange={(e) => setTip(Number(e.target.value) || 0)} className="field mt-1" />
            </label>
          </div>
          <button
            onClick={() => setTip(suggested)}
            className="text-[10px] uppercase tracking-wider text-gilt hover:text-bone"
          >
            ↳ take the mind&apos;s tip · {sol(suggested)}
          </button>
        </div>
      ) : (
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="base64 signed transactions, one per line"
          rows={4}
          className="field resize-none text-[11px]"
        />
      )}

      <button
        onClick={mode === "transfer" ? submitTransfer : submitRaw}
        className="mt-3 w-full border border-ember-dim bg-ember-deep px-3 py-2.5 text-[12px] font-bold uppercase tracking-widest text-ember transition-colors hover:border-ember hover:bg-ember/15"
      >
        {publicKey || mode === "raw" ? "fire bundle" : "connect wallet"}
      </button>
      {status && <div className="mt-2 break-all text-[10px] tabular-nums text-bone-faint">{status}</div>}
    </div>
  );
}
