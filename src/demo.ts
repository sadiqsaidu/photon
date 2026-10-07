import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { config, MEMO_PROGRAM } from "./config.js";
import { probeKeypair } from "./probe.js";
import { createPhoton } from "./sdk.js";
import { rpc } from "./solami.js";

// A self transfer with a memo, tipped and sent through a running Photon server.
export async function demo(): Promise<void> {
  const payer = probeKeypair();
  if (!payer) throw new Error("set PROBE_SECRET (a funded burner wallet) to run the demo");
  const photon = createPhoton(process.env.PHOTON_URL ?? `http://localhost:${config.port}`);

  const quote = await photon.quote({ deadlineSlots: 2, confidence: 0.9 });
  console.log(`quote: tip ${quote.tipLamports} lamports (${quote.tipSol} SOL), priority fee ${quote.priorityFeeMicroLamports} micro-lamports/CU`);
  console.log(`       P(land within ${quote.deadlineSlots} slots) = ${quote.probability}, meets 0.9: ${quote.meetsConfidence}, calibrated: ${quote.calibrated}`);

  const { value } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: value.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: quote.priorityFeeMicroLamports }),
      new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from("photon-demo") }),
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }),
      await photon.tipInstruction(payer.publicKey, quote.tipLamports),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = await photon.send(tx);
  console.log(`sent:  ${signature}`);
  const r = await photon.waitForReceipt(signature);
  const stages = Object.entries(r.stages).map(([stage, s]) => `${stage} ${s.ms} ms (slot ${s.slot})`).join(", ");
  console.log(`receipt: ${r.failure ?? "landed"} in slot ${r.landedSlot ?? "-"}${r.landedSlot ? ` (+${r.landedSlot - r.sentSlot} slots)` : ""}`);
  console.log(`         ${stages}`);
  console.log(`beam:    ${r.beam ? `landed ${r.beam.is_landed}, region ${r.beam.region}, via Jito ${r.beam.landed_via_jito}, tip ${r.beam.tip_lamports}` : "no landing record"}`);
  console.log(`https://solscan.io/tx/${signature}`);
}
