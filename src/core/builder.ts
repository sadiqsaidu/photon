import {
  ComputeBudgetProgram,
  type MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { RpcGateway, Signer } from "../shared/ports.js";
import type { BlockhashSource, Lamports } from "../shared/types.js";
import type { BlockhashCache } from "./blockhash.js";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export interface TxPayload {
  readonly kind: string;
  readonly computeUnits: number;
  build(payer: PublicKey): TransactionInstruction[];
}

export class SelfTransferMemo implements TxPayload {
  readonly kind = "self_transfer_memo";
  readonly computeUnits = 20_000;

  build(payer: PublicKey): TransactionInstruction[] {
    return [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
      new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(Date.now().toString()) }),
    ];
  }
}

export class SolTransfer implements TxPayload {
  readonly kind = "sol_transfer";
  readonly computeUnits = 20_000;

  constructor(
    private readonly to: string,
    private readonly lamports: number,
  ) {}

  build(payer: PublicKey): TransactionInstruction[] {
    return [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(this.to), lamports: this.lamports }),
    ];
  }
}

export function payloadFrom(spec: unknown): TxPayload {
  if (spec && typeof spec === "object") {
    const s = spec as { kind?: string; to?: string; lamports?: number };
    if (s.kind === "sol_transfer" && s.to && typeof s.lamports === "number") {
      return new SolTransfer(s.to, s.lamports);
    }
  }
  return new SelfTransferMemo();
}

export interface UnsignedBundle {
  messageBase64: string;
  tipAccount: string;
  tip: Lamports;
  blockhash: string;
  lastValidBlockHeight: number | null;
  blockhashSource: BlockhashSource;
}

// Explicit blockhash to sign against instead of cache/RPC: the fault demo
// injects a fabricated expired hash, and recovery can reuse a still-valid one.
export interface BlockhashOverride {
  blockhash: string;
  lastValidBlockHeight: number | null;
  source: BlockhashSource;
}

export interface BuiltBundle {
  base64: string;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number | null;
  blockhashSource: BlockhashSource;
}

export class BundleBuilder {
  constructor(
    private readonly rpc: RpcGateway,
    private readonly tipAccounts: string[],
    private readonly cache?: BlockhashCache,
  ) {}

  private tipAccount(): PublicKey {
    const pick = this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)];
    return new PublicKey(pick as string);
  }

  // Zero-RPC hot path: prefer the streamed cache (< 2 s old); RPC remains the
  // cold-start fallback.
  private async pickBlockhash(override?: BlockhashOverride): Promise<BlockhashOverride> {
    if (override) return override;
    const cached = this.cache?.fresh();
    if (cached) return { ...cached, source: "stream" };
    const r = await this.rpc.latestBlockhash("confirmed");
    return { blockhash: r.blockhash, lastValidBlockHeight: r.lastValidBlockHeight, source: "rpc" };
  }

  private async assemble(
    payload: TxPayload,
    payer: PublicKey,
    tip: Lamports,
    override?: BlockhashOverride,
  ): Promise<{ message: MessageV0; tipAccount: string } & BlockhashOverride> {
    const picked = await this.pickBlockhash(override);
    const tipAccount = this.tipAccount();
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: picked.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: payload.computeUnits }),
        ...payload.build(payer),
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: tipAccount, lamports: tip }),
      ],
    }).compileToV0Message();
    return { message, tipAccount: tipAccount.toBase58(), ...picked };
  }

  async buildUnsigned(payload: TxPayload, payer: PublicKey, tip: Lamports): Promise<UnsignedBundle> {
    const a = await this.assemble(payload, payer, tip);
    return {
      messageBase64: Buffer.from(a.message.serialize()).toString("base64"),
      tipAccount: a.tipAccount,
      tip,
      blockhash: a.blockhash,
      lastValidBlockHeight: a.lastValidBlockHeight,
      blockhashSource: a.source,
    };
  }

  async buildAndSign(
    payload: TxPayload,
    signer: Signer,
    tip: Lamports,
    override?: BlockhashOverride,
  ): Promise<BuiltBundle> {
    const payer = new PublicKey(signer.publicKey);
    const a = await this.assemble(payload, payer, tip, override);
    const tx = new VersionedTransaction(a.message);
    const sig = await signer.sign(a.message.serialize());
    tx.addSignature(payer, sig);
    return {
      base64: Buffer.from(tx.serialize()).toString("base64"),
      signature: bs58.encode(sig),
      blockhash: a.blockhash,
      lastValidBlockHeight: a.lastValidBlockHeight,
      blockhashSource: a.source,
    };
  }
}
