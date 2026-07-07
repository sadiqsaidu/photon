"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { prepareBundle, simulateTx, submitBundle } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useLeaders } from "./leaders-context";
import { base64ToBytes, bytesToBase64, sol } from "@/lib/format";

type Mode = "transfer" | "raw";

function Toggle({
  on,
  set,
  label,
  hint,
}: {
  on: boolean;
  set: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button onClick={() => set(!on)} className="flex w-full items-center justify-between py-1 text-left" title={hint}>
      <span className="text-[10px] uppercase tracking-widest text-bone-faint">{label}</span>
      <span
        className={`relative h-3.5 w-7 border transition-colors ${on ? "border-gilt bg-gilt-deep" : "border-line bg-coal"}`}
      >
        <span
          className={`absolute top-0.5 h-2 w-2 transition-all ${on ? "left-4 bg-gilt" : "left-0.5 bg-bone-ghost"}`}
        />
      </span>
    </button>
  );
}

export function BuildDock() {
  const { publicKey, signTransaction } = useWallet();
  const { state } = useStore();
  const { next } = useLeaders();
  const suggested = state.tipPolicy?.tip ?? 10_000;

  const [mode, setMode] = useState<Mode>("transfer");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [tip, setTip] = useState(suggested);
  const [raw, setRaw] = useState("");
  const [turbo, setTurbo] = useState(true);
  const [preflight, setPreflight] = useState(true);
  const [status, setStatus] = useState("");

  const open = next?.open ?? false;
  const etaS = next && !open ? (next.etaMs / 1000).toFixed(1) : null;

  async function submitTransfer() {
    if (!publicKey || !signTransaction) return setStatus("connect a wallet first");
    try {
      const lamports = Math.round(parseFloat(amount) * 1e9);
      setStatus(turbo ? "preparing · turbo blockhash…" : "preparing…");
      const prep = await prepareBundle(publicKey.toBase58(), tip, { kind: "sol_transfer", to, lamports }, turbo);
      const tx = new VersionedTransaction(VersionedMessage.deserialize(base64ToBytes(prep.messageBase64)));
      setStatus(`awaiting signature… (${prep.blockhashSource} hash)`);
      const signed = await signTransaction(tx);
      const signature = bs58.encode(signed.signatures[0]);
      const signedB64 = bytesToBase64(signed.serialize());

      if (preflight) {
        setStatus("preflight simulation…");
        const sim = await simulateTx(signedB64);
        if (sim.err) {
          const tail = sim.logs.slice(-2).join(" · ");
          setStatus(`✕ preflight failed — not submitted, no tip at risk. ${JSON.stringify(sim.err)} ${tail}`);
          return;
        }
      }

      setStatus("submitting…");
      const res = await submitBundle([signedB64], signature, prep.tip);
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
          <div className="border-t border-line pt-2">
            <Toggle
              on={turbo}
              set={setTurbo}
              label={`turbo blockhash · ${turbo ? "stream tip" : "rpc confirmed"}`}
              hint="turbo signs against the freshest streamed block (fastest, slight fork risk); off = RPC confirmed (safe)"
            />
            <Toggle
              on={preflight}
              set={setPreflight}
              label={`preflight sim · ${preflight ? "on" : "off"}`}
              hint="simulate before firing: a bundle that would fail on-chain is caught before you risk a tip"
            />
          </div>
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

      {/* fire timing: counts down to the next Jito window */}
      <div
        className={`mt-3 flex items-center justify-between border px-2.5 py-1.5 text-[10px] uppercase tracking-widest ${
          open ? "window-open border-moss-dim bg-moss-deep text-moss" : "border-line text-bone-faint"
        }`}
      >
        <span>{open ? "jito window open" : "next jito window"}</span>
        <span className="tabular-nums">{open ? "fire now" : etaS !== null ? `~${etaS}s` : "—"}</span>
      </div>

      <button
        onClick={mode === "transfer" ? submitTransfer : submitRaw}
        className={`mt-2 w-full border px-3 py-2.5 text-[12px] font-bold uppercase tracking-widest transition-colors ${
          open
            ? "window-open border-moss bg-moss-deep text-moss hover:bg-moss/20"
            : "border-ember-dim bg-ember-deep text-ember hover:border-ember hover:bg-ember/15"
        }`}
      >
        {publicKey || mode === "raw" ? (open ? "fire bundle — window open" : "fire bundle") : "connect wallet"}
      </button>
      {status && <div className="mt-2 break-all text-[10px] tabular-nums text-bone-faint">{status}</div>}
    </div>
  );
}
