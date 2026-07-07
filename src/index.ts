import { PublicKey } from "@solana/web3.js";
import { loadConfig, type Config } from "./config.js";
import { Yellowstone } from "./adapters/yellowstone.js";
import { MultiStream, type ProviderConfig } from "./adapters/multistream.js";
import { JitoEngine } from "./adapters/jito.js";
import { JitoMulti } from "./adapters/jito-multi.js";
import { SolanaRpc } from "./adapters/rpc.js";
import { Gemini } from "./adapters/gemini.js";
import { OpenRouter } from "./adapters/openrouter.js";
import { signerFromSecret } from "./adapters/signer.js";
import { Agent } from "./agent/index.js";
import type { LlmClient } from "./shared/ports.js";
import { BundleBuilder, SelfTransferMemo } from "./core/builder.js";
import { BlockhashCache } from "./core/blockhash.js";
import { TipOracle } from "./core/tip-oracle.js";
import { TipStream } from "./core/tip-stream.js";
import { TipForecaster } from "./core/tip-forecast.js";
import { LeaderWindow } from "./core/leader.js";
import { NetworkMonitor } from "./core/network.js";
import { Worker } from "./core/worker.js";
import { Submitter } from "./core/submission.js";
import { createApi } from "./api/server.js";
import { makeDb } from "./db/index.js";
import { Store } from "./db/store.js";
import { info, warn } from "./shared/log.js";
import { JITO_TIP_ACCOUNTS, SLOT_MS } from "./core/constants.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeLlm(cfg: Config): { client: LlmClient; model: string } {
  if (cfg.openrouterKey) {
    const [primary, ...fallbacks] = cfg.openrouterModels;
    return {
      client: new OpenRouter(cfg.openrouterKey, fallbacks),
      model: primary ?? "meta-llama/llama-3.3-70b-instruct:free",
    };
  }
  if (cfg.geminiKey) return { client: new Gemini(cfg.geminiKey), model: cfg.geminiModel };
  throw new Error("set OPENROUTER_API_KEY or GEMINI_API_KEY");
}

// Watch our own wallet plus every Jito tip account: the builder picks a random
// tip account per bundle, so watching a single account would miss ~7/8 of our
// own submissions and misclassify them as expired.
function watchSet(cfg: Config): string[] {
  const walletPubkey = cfg.walletSecret
    ? signerFromSecret(cfg.walletSecret).publicKey
    : cfg.walletPubkey;
  return [...new Set([cfg.watchAccount, ...(walletPubkey ? [walletPubkey] : []), ...JITO_TIP_ACCOUNTS])];
}

function providerName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function grpcProviders(cfg: Config): ProviderConfig[] {
  const providers: ProviderConfig[] = [{ name: providerName(cfg.grpcUrl), url: cfg.grpcUrl, token: cfg.grpcToken }];
  if (cfg.grpcUrl2) providers.push({ name: providerName(cfg.grpcUrl2), url: cfg.grpcUrl2, token: cfg.grpcToken2 });
  return providers;
}

function checkTipAccounts(jito: JitoMulti): void {
  void jito
    .tipAccounts()
    .then((remote) => {
      const local = new Set<string>(JITO_TIP_ACCOUNTS);
      const remoteSet = new Set(remote);
      const diff = [
        ...remote.filter((a) => !local.has(a)),
        ...JITO_TIP_ACCOUNTS.filter((a) => !remoteSet.has(a)),
      ];
      if (diff.length > 0) warn("jito", "tip account set differs from hardcoded constants", { diff });
    })
    .catch((e: unknown) => warn("jito", "tip account cross-check failed", String(e)));
}

// Boot must never depend on Jito being reachable: the 8 tip accounts are
// static and hardcoded, so a block-engine timeout falls back to them.
async function tipAccountsOrDefault(jito: JitoMulti): Promise<string[]> {
  try {
    return await jito.tipAccounts();
  } catch (e) {
    warn("jito", "tipAccounts unavailable at boot, using hardcoded set", String(e));
    return [...JITO_TIP_ACCOUNTS];
  }
}

function stack(cfg: Config) {
  const rpc = new SolanaRpc(cfg.rpcUrl);
  const jito = new JitoMulti(cfg.jitoEngines.map((u) => new JitoEngine(u)));
  const store = new Store(makeDb(cfg.databaseUrl));
  const accounts = watchSet(cfg);
  const stream = new MultiStream(
    grpcProviders(cfg).map((p) => new Yellowstone(p.name, p.url, p.token, accounts)),
  );
  checkTipAccounts(jito);
  const tipStream = new TipStream();
  const forecaster = new TipForecaster();
  tipStream.onSlotP50 = (_slot, p50) => forecaster.observe(p50);
  const oracle = new TipOracle(tipStream);
  const monitor = new NetworkMonitor(rpc, oracle);
  const leader = new LeaderWindow(rpc, (id) => monitor.isJito(id));
  const blockhash = new BlockhashCache();
  const llm = makeLlm(cfg);
  const agent = new Agent(llm.client, llm.model, cfg.tipCeiling);
  const worker = new Worker(stream, jito, oracle, leader, agent, store, cfg.tipCeiling, blockhash, tipStream, forecaster);
  return { rpc, jito, store, oracle, agent, worker, monitor, leader, blockhash, stream };
}

// What the deck's Jito-windows table renders: the next windows from the local
// schedule, enriched with validator metadata from the Kobe set.
function leadersPayload(s: Stack) {
  const status = s.leader.status();
  return {
    currentSlot: s.leader.currentSlot(),
    windowOpen: status.open,
    slotsToLeader: status.slotsToLeader,
    slotMs: SLOT_MS,
    windows: s.leader.upcomingWindows(10).map((w) => ({
      ...w,
      etaMs: Math.max(0, w.slotsAway) * SLOT_MS,
      validator: s.monitor.info(w.identity),
    })),
  };
}

type Stack = ReturnType<typeof stack>;

// SIGINT closes the gRPC streams, stops every interval, and ends the SSE
// server. JSONL rows are written with appendFileSync, so nothing needs
// flushing beyond letting in-flight settles finish their synchronous write.
function onShutdown(s: Stack, api?: import("node:http").Server): void {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    info("main", "shutting down");
    s.worker.close();
    s.monitor.close();
    s.jito.close();
    api?.closeAllConnections?.();
    api?.close();
    void s.stream.close().finally(() => process.exit(0));
    // Belt and braces: never hang the terminal on a stuck close.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function observe(cfg: Config): Promise<void> {
  const s = stack(cfg);
  info("main", "watching account", { account: cfg.watchAccount });
  s.worker.start();
  s.monitor.start();
  onShutdown(s);
}

type SubmitVariant = "normal" | "fault" | "fault2";

async function submitMode(cfg: Config, variant: SubmitVariant): Promise<void> {
  if (!cfg.walletSecret) throw new Error("set WALLET_SECRET (throwaway) to run submit/fault/fault2");
  const s = stack(cfg);
  const signer = signerFromSecret(cfg.walletSecret);
  const builder = new BundleBuilder(s.rpc, await tipAccountsOrDefault(s.jito), s.blockhash);
  const submitter = new Submitter(builder, s.jito, signer, s.agent, s.oracle, s.store, s.worker, s.blockhash, s.leader);
  s.worker.onSubmittedFailure = (l) => submitter.onFailure(l);
  s.worker.start();
  onShutdown(s);

  const runs = variant === "normal" ? 10 : 1;
  info("main", "submitting", { wallet: signer.publicKey, runs, variant });
  for (let i = 0; i < runs; i++) {
    // fault: fabricated expired blockhash -> expired_blockhash + recovery.
    // fault2: Jito-minimum tip (1000) -> realistic non-landing -> the
    // bundleStatus/leader-window path classifies bundle_dropped and the agent
    // reasons about raising the tip.
    const opts =
      variant === "fault"
        ? { fault: true, ttlMs: 15_000 }
        : variant === "fault2"
          ? { tip: 1000, ttlMs: 20_000 }
          : {};
    await submitter.submit(new SelfTransferMemo(), opts);
    await sleep(8000);
  }
  info("main", "runs finished; still tracking lifecycles (Ctrl-C to exit)");
}

async function serve(cfg: Config): Promise<void> {
  const s = stack(cfg);
  const builder = new BundleBuilder(s.rpc, await tipAccountsOrDefault(s.jito), s.blockhash);
  const signer = cfg.walletSecret ? signerFromSecret(cfg.walletSecret) : undefined;
  const submitter = new Submitter(builder, s.jito, signer, s.agent, s.oracle, s.store, s.worker, s.blockhash, s.leader);
  s.worker.onSubmittedFailure = (l) => submitter.onFailure(l);
  s.worker.start();
  s.monitor.start();

  const api = createApi({
    builder,
    submitter,
    defaultTip: () => s.worker.tip().tip,
    hasSigner: Boolean(signer),
    leaders: () => leadersPayload(s),
    engines: () => s.jito.latencies(),
    simulate: (b64) => s.rpc.simulate(b64),
  });
  api.listen(cfg.port, () => info("api", "listening", { port: cfg.port, watch: cfg.watchAccount }));
  onShutdown(s, api);
}

async function construct(cfg: Config): Promise<void> {
  if (!cfg.walletPubkey) throw new Error("set WALLET_PUBKEY to build an unsigned bundle");
  const jito = new JitoMulti(cfg.jitoEngines.map((u) => new JitoEngine(u)));
  const builder = new BundleBuilder(new SolanaRpc(cfg.rpcUrl), await tipAccountsOrDefault(jito));
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
        ? submitMode(cfg, "normal")
        : mode === "fault"
          ? submitMode(cfg, "fault")
          : mode === "fault2"
            ? submitMode(cfg, "fault2")
            : observe(cfg);

run.catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
