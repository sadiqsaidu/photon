import { PublicKey, SystemProgram, type Transaction, type TransactionInstruction, type VersionedTransaction } from "@solana/web3.js";

export interface Quote {
  deadlineSlots: number;
  confidence: number;
  tipLamports: number;
  tipSol: number;
  priorityFeeMicroLamports: number;
  probability: number;
  meetsConfidence: boolean;
  calibrated: boolean;
  bucket: { lo: number; hi: number };
  distribution: { source: "beam" | "combined"; samples: number; beamFloorPercentile: number };
  heatMultiplier: number;
}

export interface Receipt {
  signature: string;
  kind: "probe" | "sdk";
  sentSlot: number;
  landedSlot: number | null;
  tip: number;
  stages: Partial<Record<"submitted" | "processed" | "confirmed" | "finalized", { slot: number; ms: number }>>;
  failure: "send_rejected" | "failed_onchain" | "leader_skipped" | "expired_blockhash" | null;
  error: string | null;
  beam: { is_landed: boolean; region: string; landed_via_jito: boolean; tip_lamports: number } | null;
  settled: boolean;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function createPhoton(baseUrl: string) {
  const root = baseUrl.replace(/\/$/, "");
  let tipAddresses: string[] | null = null;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${root}${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(`photon ${path}: ${body.error ?? res.status}`);
    return body;
  }

  return {
    quote({ deadlineSlots = 2, confidence = 0.9 } = {}): Promise<Quote> {
      return call<Quote>(`/quote?deadline=${deadlineSlots}&confidence=${confidence}`);
    },

    // A transfer to a random Beam tip address; Beam only accepts transactions that carry one.
    async tipInstruction(payer: PublicKey, lamports: number): Promise<TransactionInstruction> {
      tipAddresses ??= (await call<{ beam: string[] }>("/tips/addresses")).beam;
      const to = new PublicKey(tipAddresses[Math.floor(Math.random() * tipAddresses.length)] as string);
      return SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports });
    },

    async send(tx: VersionedTransaction | Transaction): Promise<string> {
      const body = JSON.stringify({ tx: base64(tx.serialize()) });
      const out = await call<{ signature: string }>("/send", { method: "POST", headers: { "content-type": "application/json" }, body });
      return out.signature;
    },

    async waitForReceipt(signature: string, { timeoutMs = 120_000, pollMs = 1_000 } = {}): Promise<Receipt> {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const r = await call<Receipt>(`/receipt/${signature}`).catch(() => null);
        if (r?.settled) return r;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      throw new Error(`no settled receipt for ${signature} after ${timeoutMs} ms`);
    },
  };
}
