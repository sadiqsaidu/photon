import { BLOCKHASH_VALID_BLOCKS } from "./constants.js";

// A cached blockhash older than this is not worth signing against when the
// stream is flowing; the builder falls back to RPC instead.
const FRESH_MS = 2000;

interface Latest {
  blockhash: string;
  blockHeight: number;
  slot: number;
  at: number;
}

// Streamed blockhash cache: fed by blocksMeta events, it removes the RPC
// getLatestBlockhash call from the submit hot path and gives the lifecycle
// tracker a precise expiry reference (chain block height).
export class BlockhashCache {
  private latest: Latest | null = null;
  private chainHeight = 0;

  onBlock(e: { slot: number; blockhash: string; blockHeight: number }, at = Date.now()): void {
    if (e.blockHeight > this.chainHeight) this.chainHeight = e.blockHeight;
    if (!this.latest || e.slot >= this.latest.slot) {
      this.latest = { blockhash: e.blockhash, blockHeight: e.blockHeight, slot: e.slot, at };
    }
  }

  fresh(): { blockhash: string; lastValidBlockHeight: number } | null {
    if (!this.latest || Date.now() - this.latest.at > FRESH_MS) return null;
    return {
      blockhash: this.latest.blockhash,
      lastValidBlockHeight: this.latest.blockHeight + BLOCKHASH_VALID_BLOCKS,
    };
  }

  currentHeight(): number {
    return this.chainHeight;
  }

  isValid(lastValidBlockHeight: number): boolean {
    return this.currentHeight() <= lastValidBlockHeight;
  }
}
