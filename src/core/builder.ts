import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { RpcGateway } from "../shared/ports.js";
import type { Lamports } from "../shared/types.js";

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
    const nonce = Date.now().toString();
    return [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
      new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(nonce) }),
    ];
  }
}

export function loadKeypair(secret: string): Keypair {
  const bytes = secret.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(secret) as number[])
    : bs58.decode(secret.trim());
  return Keypair.fromSecretKey(bytes);
}

export class BundleBuilder {
  constructor(
    private readonly rpc: RpcGateway,
    private readonly signer: Keypair,
    private readonly tipAccounts: string[],
  ) {}

  private tipAccount(): PublicKey {
    const pick = this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)];
    return new PublicKey(pick as string);
  }

  async build(
    payload: TxPayload,
    tip: Lamports,
    staleBlockhash?: string,
  ): Promise<{ base64: string; signature: string }> {
    const blockhash = staleBlockhash ?? (await this.rpc.latestBlockhash("confirmed")).blockhash;
    const payer = this.signer.publicKey;
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: payload.computeUnits }),
      ...payload.build(payer),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: this.tipAccount(), lamports: tip }),
    ];
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([this.signer]);
    return {
      base64: Buffer.from(tx.serialize()).toString("base64"),
      signature: bs58.encode(tx.signatures[0] as Uint8Array),
    };
  }
}
