import "dotenv/config";
import { DEFAULT_JITO_ENGINES } from "./adapters/jito-multi.js";

export interface Config {
  rpcUrl: string;
  grpcUrl: string;
  grpcToken: string | undefined;
  grpcUrl2: string | undefined;
  grpcToken2: string | undefined;
  jitoEngines: string[];
  geminiKey: string | undefined;
  geminiModel: string;
  openrouterKey: string | undefined;
  openrouterModel: string;
  watchAccount: string;
  walletPubkey: string | undefined;
  walletSecret: string | undefined;
  databaseUrl: string;
  tipCeiling: number;
  port: number;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function loadConfig(): Config {
  return {
    rpcUrl: req("RPC_URL"),
    grpcUrl: req("GRPC_URL"),
    grpcToken: process.env.GRPC_TOKEN,
    grpcUrl2: process.env.GRPC_URL_2,
    grpcToken2: process.env.GRPC_TOKEN_2,
    jitoEngines: (process.env.JITO_ENGINES ?? process.env.JITO_ENGINE ?? DEFAULT_JITO_ENGINES.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    openrouterKey: process.env.OPENROUTER_API_KEY,
    openrouterModel: process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",
    watchAccount: req("WATCH_ACCOUNT"),
    walletPubkey: process.env.WALLET_PUBKEY,
    walletSecret: process.env.WALLET_SECRET,
    databaseUrl: req("DATABASE_URL"),
    tipCeiling: Number(process.env.TIP_CEILING_LAMPORTS ?? 200_000),
    port: Number(process.env.PORT ?? 8080),
  };
}
