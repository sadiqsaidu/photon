import type { SolanaRpc } from "../adapters/rpc.js";
import type { TipOracle } from "./tip-oracle.js";
import { bus } from "../shared/bus.js";
import { info, warn } from "../shared/log.js";

const KOBE = "https://kobe.mainnet.jito.network/api/v1/validators";
const JITO_REFRESH_MS = 300_000;
const TICK_MS = 5000;
// After repeated RPC failures, poll slower instead of spamming warnings.
const BACKOFF_TICK_MS = 15_000;
const BACKOFF_AFTER = 3;

interface KobeValidator {
  vote_account: string;
  running_jito: boolean;
  mev_commission_bps?: number;
}

export interface ValidatorInfo {
  votePubkey: string;
  activatedStake: number;
  commission: number;
  mevCommissionBps: number | null;
  runningJito: boolean;
}

export class NetworkMonitor {
  private jito = new Set<string>();
  private meta = new Map<string, ValidatorInfo>(); // by node identity
  private slot = 0;
  private failures = 0;
  private tickTimer: NodeJS.Timeout | null = null;
  private jitoTimer: NodeJS.Timeout | null = null;
  private unsub: (() => void) | null = null;

  constructor(
    private readonly rpc: SolanaRpc,
    private readonly oracle: TipOracle,
  ) {}

  isJito(identity: string): boolean {
    return this.jito.has(identity);
  }

  info(identity: string): ValidatorInfo | null {
    return this.meta.get(identity) ?? null;
  }

  start(): void {
    // ride the stream's slot instead of burning an RPC call per tick
    this.unsub = bus.subscribe((ev) => {
      if (ev.type === "slot" && ev.slot > this.slot) this.slot = ev.slot;
    });
    void this.refreshJito();
    this.jitoTimer = setInterval(() => void this.refreshJito(), JITO_REFRESH_MS);
    this.schedule(0);
  }

  close(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.jitoTimer) clearInterval(this.jitoTimer);
    this.tickTimer = null;
    this.jitoTimer = null;
    this.unsub?.();
    this.unsub = null;
  }

  private schedule(delay: number): void {
    this.tickTimer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    try {
      const slot = this.slot > 0 ? this.slot : await this.rpc.slot();
      const [leaders, epoch, tps] = await Promise.all([
        this.rpc.slotLeaders(slot, 8),
        this.rpc.epochInfo(),
        this.rpc.tps(),
      ]);
      const leader = leaders[0] ?? null;
      const nextLeader = leaders.find((l) => l !== leader) ?? null;
      bus.publish({
        type: "network",
        slot,
        leader,
        leaderIsJito: leader ? this.jito.has(leader) : false,
        nextLeader,
        nextIsJito: nextLeader ? this.jito.has(nextLeader) : false,
        epoch: epoch.epoch,
        epochProgress: epoch.slotsInEpoch > 0 ? epoch.slotIndex / epoch.slotsInEpoch : 0,
        tps,
        tipFloor: this.oracle.floor().p50,
      });
      if (this.failures >= BACKOFF_AFTER) info("network", "rpc recovered");
      this.failures = 0;
      this.schedule(TICK_MS);
    } catch (e) {
      this.failures++;
      if (this.failures === 1 || this.failures % 10 === 0) {
        warn("network", "tick failed", { consecutive: this.failures, error: String(e) });
      }
      this.schedule(this.failures >= BACKOFF_AFTER ? BACKOFF_TICK_MS : TICK_MS);
    }
  }

  private async refreshJito(): Promise<void> {
    try {
      const res = await fetch(KOBE);
      const data = (await res.json()) as KobeValidator[] | { validators: KobeValidator[] };
      const list = Array.isArray(data) ? data : data.validators;
      const byVote = new Map(list.map((v) => [v.vote_account, v]));
      const votes = await this.rpc.voteAccounts();
      const ids = new Set<string>();
      const meta = new Map<string, ValidatorInfo>();
      for (const v of votes) {
        const k = byVote.get(v.votePubkey);
        if (k?.running_jito) ids.add(v.nodePubkey);
        meta.set(v.nodePubkey, {
          votePubkey: v.votePubkey,
          activatedStake: v.activatedStake,
          commission: v.commission,
          mevCommissionBps: k?.mev_commission_bps ?? null,
          runningJito: Boolean(k?.running_jito),
        });
      }
      if (ids.size > 0) {
        this.jito = ids;
        this.meta = meta;
      }
    } catch (e) {
      warn("network", "jito validator set unavailable", String(e));
    }
  }
}
