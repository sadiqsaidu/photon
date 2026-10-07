import { doctor } from "./doctor.js";

const mode = process.argv[2];

async function main(): Promise<void> {
  if (mode === "doctor") {
    process.exit((await doctor()) ? 0 : 1);
  }
  throw new Error(`unknown mode "${mode ?? ""}". Use: serve | doctor | demo`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
