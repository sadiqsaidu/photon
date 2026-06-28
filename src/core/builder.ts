import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
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
    return [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
      new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(Date.now().toString()) }),
    ];
  }
}

export interface UnsignedBundle {
  messageBase64: string;
  tipAccount: string;
  tip: Lamports;
  blockhash: string;
}

export class BundleBuilder {
  constructor(
    private readonly rpc: RpcGateway,
    private readonly tipAccounts: string[],
  ) {}

  private tipAccount(): PublicKey {
    const pick = this.tipAccounts[Math.floor(Math.random() * this.tipAccounts.length)];
    return new PublicKey(pick as string);
  }

  async buildUnsigned(payload: TxPayload, payer: PublicKey, tip: Lamports): Promise<UnsignedBundle> {
    const { blockhash } = await this.rpc.latestBlockhash("confirmed");
    const tipAccount = this.tipAccount();
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: payload.computeUnits }),
        ...payload.build(payer),
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: tipAccount, lamports: tip }),
      ],
    }).compileToV0Message();
    return {
      messageBase64: Buffer.from(message.serialize()).toString("base64"),
      tipAccount: tipAccount.toBase58(),
      tip,
      blockhash,
    };
  }
}
