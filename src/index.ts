import { loadConfig } from "./config.js";
import { Yellowstone } from "./adapters/yellowstone.js";
import { JitoEngine } from "./adapters/jito.js";
import { SolanaRpc } from "./adapters/rpc.js";
import { Gemini } from "./adapters/gemini.js";
import { Agent } from "./agent/index.js";
import { BundleBuilder, SelfTransferMemo, loadKeypair } from "./core/builder.js";
import { TipOracle } from "./core/tip-oracle.js";
import { LeaderWindow } from "./core/leader.js";
import { Orchestrator } from "./core/orchestrator.js";
import { info } from "./shared/log.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.geminiKey) throw new Error("missing env GEMINI_API_KEY");

  const keypair = loadKeypair(cfg.walletSecret);
  const rpc = new SolanaRpc(cfg.rpcUrl);
  const jito = new JitoEngine(cfg.jitoEngine);
  const stream = new Yellowstone(cfg.grpcUrl, cfg.grpcToken, keypair.publicKey.toBase58());
  const agent = new Agent(new Gemini(cfg.geminiKey), cfg.geminiModelFast, cfg.geminiModelDeep, cfg.tipCeiling);

  const builder = new BundleBuilder(rpc, keypair, await jito.tipAccounts());
  const oracle = new TipOracle();
  const leader = new LeaderWindow(jito);
  const orch = new Orchestrator(cfg, stream, jito, builder, oracle, leader, agent);
  await orch.start();

  const fault = process.argv[2] === "fault";
  const runs = fault ? 1 : 10;
  info("main", "starting submissions", { wallet: keypair.publicKey.toBase58(), runs, fault });
  for (let i = 0; i < runs; i++) {
    await orch.submit(new SelfTransferMemo(), fault ? { fault: true, ttlMs: 15_000 } : {});
    await new Promise((r) => setTimeout(r, 8000));
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
