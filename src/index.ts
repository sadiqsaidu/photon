import { PublicKey } from "@solana/web3.js";
import { loadConfig, type Config } from "./config.js";
import { Yellowstone } from "./adapters/yellowstone.js";
import { JitoEngine } from "./adapters/jito.js";
import { SolanaRpc } from "./adapters/rpc.js";
import { Gemini } from "./adapters/gemini.js";
import { OpenRouter } from "./adapters/openrouter.js";
import { signerFromSecret } from "./adapters/signer.js";
import { Agent } from "./agent/index.js";
import type { LlmClient } from "./shared/ports.js";
import { BundleBuilder, SelfTransferMemo } from "./core/builder.js";
import { TipOracle } from "./core/tip-oracle.js";
import { LeaderWindow } from "./core/leader.js";
import { NetworkMonitor } from "./core/network.js";
import { Worker } from "./core/worker.js";
import { Submitter } from "./core/submission.js";
import { createApi } from "./api/server.js";
import { makeDb } from "./db/index.js";
import { Store } from "./db/store.js";
import { info } from "./shared/log.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeLlm(cfg: Config): { client: LlmClient; model: string } {
  if (cfg.openrouterKey) return { client: new OpenRouter(cfg.openrouterKey), model: cfg.openrouterModel };
  if (cfg.geminiKey) return { client: new Gemini(cfg.geminiKey), model: cfg.geminiModel };
  throw new Error("set OPENROUTER_API_KEY or GEMINI_API_KEY");
}

function stack(cfg: Config) {
  const rpc = new SolanaRpc(cfg.rpcUrl);
  const jito = new JitoEngine(cfg.jitoEngine);
  const store = new Store(makeDb(cfg.databaseUrl));
  const stream = new Yellowstone(cfg.grpcUrl, cfg.grpcToken, cfg.watchAccount);
  const oracle = new TipOracle();
  const leader = new LeaderWindow(jito);
  const llm = makeLlm(cfg);
  const agent = new Agent(llm.client, llm.model, cfg.tipCeiling);
  const worker = new Worker(stream, jito, oracle, leader, agent, store, cfg.tipCeiling);
  const monitor = new NetworkMonitor(rpc, oracle);
  return { rpc, jito, store, oracle, agent, worker, monitor };
}

async function observe(cfg: Config): Promise<void> {
  const { worker, monitor } = stack(cfg);
  info("main", "watching account", { account: cfg.watchAccount });
  worker.start();
  monitor.start();
}

async function submitMode(cfg: Config, fault: boolean): Promise<void> {
  if (!cfg.walletSecret) throw new Error("set WALLET_SECRET (throwaway) to run submit/fault");
  const s = stack(cfg);
  const signer = signerFromSecret(cfg.walletSecret);
  const builder = new BundleBuilder(s.rpc, await s.jito.tipAccounts());
  const submitter = new Submitter(builder, s.jito, signer, s.agent, s.oracle, s.store, s.worker);
  s.worker.onSubmittedFailure = (l) => submitter.onFailure(l);
  s.worker.start();

  const runs = fault ? 1 : 10;
  info("main", "submitting", { wallet: signer.publicKey, runs, fault });
  for (let i = 0; i < runs; i++) {
    await submitter.submit(new SelfTransferMemo(), fault ? { fault: true, ttlMs: 15_000 } : {});
    await sleep(8000);
  }
}

async function serve(cfg: Config): Promise<void> {
  const s = stack(cfg);
  const builder = new BundleBuilder(s.rpc, await s.jito.tipAccounts());
  const signer = cfg.walletSecret ? signerFromSecret(cfg.walletSecret) : undefined;
  const submitter = new Submitter(builder, s.jito, signer, s.agent, s.oracle, s.store, s.worker);
  s.worker.onSubmittedFailure = (l) => submitter.onFailure(l);
  s.worker.start();
  s.monitor.start();

  const api = createApi({ builder, submitter, defaultTip: () => s.worker.tip().tip, hasSigner: Boolean(signer) });
  api.listen(cfg.port, () => info("api", "listening", { port: cfg.port, watch: cfg.watchAccount }));
}

async function construct(cfg: Config): Promise<void> {
  if (!cfg.walletPubkey) throw new Error("set WALLET_PUBKEY to build an unsigned bundle");
  const jito = new JitoEngine(cfg.jitoEngine);
  const builder = new BundleBuilder(new SolanaRpc(cfg.rpcUrl), await jito.tipAccounts());
  const unsigned = await builder.buildUnsigned(new SelfTransferMemo(), new PublicKey(cfg.walletPubkey), 10_000);
  info("construct", "unsigned bundle ready (sign client-side)", unsigned);
}

const cfg = loadConfig();
const mode = process.argv[2];
const run =
  mode === "serve"
    ? serve(cfg)
    : mode === "construct"
      ? construct(cfg)
      : mode === "submit"
        ? submitMode(cfg, false)
        : mode === "fault"
          ? submitMode(cfg, true)
          : observe(cfg);

run.catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
