import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { Signer } from "../shared/ports.js";

export class LocalSigner implements Signer {
  readonly publicKey: string;

  constructor(private readonly keypair: Keypair) {
    this.publicKey = keypair.publicKey.toBase58();
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return nacl.sign.detached(message, this.keypair.secretKey);
  }
}

export function ephemeralSigner(): LocalSigner {
  return new LocalSigner(Keypair.generate());
}

export function signerFromSecret(secret: string): LocalSigner {
  const bytes = secret.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(secret) as number[])
    : bs58.decode(secret.trim());
  return new LocalSigner(Keypair.fromSecretKey(bytes));
}
