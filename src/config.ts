import "dotenv/config";

export interface Config {
  rpcUrl: string;
  grpcUrl: string;
  grpcToken: string | undefined;
  jitoEngine: string;
  geminiKey: string | undefined;
  geminiModelFast: string;
  geminiModelDeep: string;
  walletSecret: string;
  tipCeiling: number;
  budget: number;
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
    jitoEngine: process.env.JITO_ENGINE ?? "https://frankfurt.mainnet.block-engine.jito.wtf",
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModelFast: process.env.GEMINI_MODEL_FAST ?? "gemini-2.0-flash",
    geminiModelDeep: process.env.GEMINI_MODEL_DEEP ?? "gemini-2.5-pro",
    walletSecret: req("WALLET_SECRET"),
    tipCeiling: Number(process.env.TIP_CEILING_LAMPORTS ?? 200_000),
    budget: Number(process.env.BUDGET_LAMPORTS ?? 50_000_000),
  };
}
