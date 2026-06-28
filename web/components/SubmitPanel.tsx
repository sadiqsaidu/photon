"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { injectFault, prepareBundle, submitBundle } from "@/lib/api";
import { base64ToBytes, bytesToBase64 } from "@/lib/format";

export function SubmitPanel() {
  const { publicKey, signTransaction } = useWallet();
  const [status, setStatus] = useState<string>("");

  async function onSubmit() {
    if (!publicKey || !signTransaction) {
      setStatus("connect a wallet first");
      return;
    }
    try {
      setStatus("preparing…");
      const prep = await prepareBundle(publicKey.toBase58());
      const message = VersionedMessage.deserialize(base64ToBytes(prep.messageBase64));
      const tx = new VersionedTransaction(message);
      setStatus("awaiting signature…");
      const signed = await signTransaction(tx);
      const signature = bs58.encode(signed.signatures[0]);
      setStatus("submitting…");
      const res = await submitBundle(bytesToBase64(signed.serialize()), signature, prep.tip);
      setStatus(res.bundleId ? `submitted · ${res.bundleId}` : "submitted (no bundle id)");
    } catch (e) {
      setStatus(`error · ${String(e)}`);
    }
  }

  async function onFault() {
    try {
      setStatus("injecting fault…");
      const res = await injectFault();
      setStatus(`fault submitted · ${res.signature.slice(0, 8)}…`);
    } catch (e) {
      setStatus(`fault unavailable · ${String(e)}`);
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">submit</span>
        <span className="text-[11px] text-zinc-500">{publicKey ? "wallet connected" : "no wallet"}</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          className="flex-1 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent hover:bg-accent/20"
        >
          Submit bundle
        </button>
        <button
          onClick={onFault}
          className="rounded-md border border-fail/40 bg-fail/10 px-3 py-2 text-xs text-fail hover:bg-fail/20"
        >
          Inject fault
        </button>
      </div>

      {status && <div className="mt-3 break-all text-[11px] text-zinc-500">{status}</div>}
    </div>
  );
}
