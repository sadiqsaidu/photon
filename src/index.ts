import { PublicKey } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import { Yellowstone } from "./adapters/yellowstone.js";
import { JitoEngine } from "./adapters/jito.js";
import { SolanaRpc } from "./adapters/rpc.js";
import { Gemini } from "./adapters/gemini.js";
import { Agent } from "./agent/index.js";
import { BundleBuilder, SelfTransferMemo } from "./core/builder.js";
import { TipOracle } from "./core/tip-oracle.js";
import { LeaderWindow } from "./core/leader.js";
import { Worker } from "./core/worker.js";
import { makeDb } from "./db/index.js";
import { Store } from "./db/store.js";
import { info } from "./shared/log.js";

async function construct(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.walletPubkey) throw new Error("set WALLET_PUBKEY to build an unsigned bundle");
  const jito = new JitoEngine(cfg.jitoEngine);
  const builder = new BundleBuilder(new SolanaRpc(cfg.rpcUrl), await jito.tipAccounts());
  const unsigned = await builder.buildUnsigned(new SelfTransferMemo(), new PublicKey(cfg.walletPubkey), 10_000);
  info("construct", "unsigned bundle ready (sign client-side)", unsigned);
}

async function observe(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.geminiKey) throw new Error("missing env GEMINI_API_KEY");
  const store = new Store(makeDb(cfg.databaseUrl));
  const jito = new JitoEngine(cfg.jitoEngine);
  const stream = new Yellowstone(cfg.grpcUrl, cfg.grpcToken, cfg.watchAccount);
  const agent = new Agent(new Gemini(cfg.geminiKey), cfg.geminiModel, cfg.tipCeiling);
  const worker = new Worker(stream, jito, new TipOracle(), new LeaderWindow(jito), agent, store);
  info("main", "watching account", { account: cfg.watchAccount });
  await worker.start();
}

const run = process.argv[2] === "construct" ? construct : observe;
run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
