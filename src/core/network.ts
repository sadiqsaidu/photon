import type { SolanaRpc } from "../adapters/rpc.js";
import type { TipOracle } from "./tip-oracle.js";
import { bus } from "../shared/bus.js";
import { warn } from "../shared/log.js";

const KOBE = "https://kobe.mainnet.jito.network/api/v1/validators";
const JITO_REFRESH_MS = 300_000;

interface KobeValidator {
  vote_account: string;
  running_jito: boolean;
}

export class NetworkMonitor {
  private jito = new Set<string>();

  constructor(
    private readonly rpc: SolanaRpc,
    private readonly oracle: TipOracle,
  ) {}

  isJito(identity: string): boolean {
    return this.jito.has(identity);
  }

  start(): void {
    void this.refreshJito();
    setInterval(() => void this.refreshJito(), JITO_REFRESH_MS);
    void this.tick();
    setInterval(() => void this.tick(), 3000);
  }

  private async tick(): Promise<void> {
    try {
      const slot = await this.rpc.slot();
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
    } catch (e) {
      warn("network", "tick failed", String(e));
    }
  }

  private async refreshJito(): Promise<void> {
    try {
      const res = await fetch(KOBE);
      const data = (await res.json()) as KobeValidator[] | { validators: KobeValidator[] };
      const list = Array.isArray(data) ? data : data.validators;
      const jitoVotes = new Set(list.filter((v) => v.running_jito).map((v) => v.vote_account));
      const votes = await this.rpc.voteAccounts();
      const ids = new Set<string>();
      for (const v of votes) if (jitoVotes.has(v.votePubkey)) ids.add(v.nodePubkey);
      if (ids.size > 0) this.jito = ids;
    } catch (e) {
      warn("network", "jito validator set unavailable", String(e));
    }
  }
}
