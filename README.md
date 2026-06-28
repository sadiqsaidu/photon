# Photon — Smart Transaction Stack

Photon observes Solana in real time over Yellowstone gRPC, submits transactions
as Jito bundles inside the correct leader window, tracks each bundle across every
commitment level, and lets a Gemini-backed agent own the tip decision and the
reasoning behind every recovery from failure.

Architecture document: see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Layout

```
src/
  adapters/   network edge: yellowstone (gRPC), jito, rpc, gemini
  core/       pure logic: leader, tip-oracle, builder, lifecycle, classifier, orchestrator
  agent/      AI layer behind a single DecisionPort
  shared/     types, ports, structured + lifecycle logging
```

The agent only ever sees a typed `DecisionPort`. The core never knows it is
talking to an LLM — that boundary is the only contact point between the AI layer
and the transaction stack.

## Setup

Requires Node >= 20.

```bash
npm install
cp .env.example .env   # fill in RPC_URL, GRPC_URL/GRPC_TOKEN, GEMINI_API_KEY, WALLET_SECRET
npm run typecheck
```

- **RPC_URL** — any Solana mainnet JSON-RPC (Helius free tier works).
- **GRPC_URL / GRPC_TOKEN** — a Yellowstone/Geyser gRPC endpoint (Shyft free tier works).
- **GEMINI_API_KEY** — Google AI Studio key.
- **WALLET_SECRET** — base58 secret key or a JSON byte array. Fund with a small
  amount of SOL; tips are bounded by `TIP_CEILING_LAMPORTS` and total spend by
  `BUDGET_LAMPORTS`.

## Run

```bash
npm start          # submit 10 bundles, track each to finalization
npm run fault      # inject a blockhash-expiry failure; agent recovers autonomously
```

Lifecycle records are appended to `logs/lifecycle/<date>.jsonl`, one sealed entry
per bundle with slot numbers, commitment stages, timestamps, latency deltas, tip
amount, failure classification, and the agent's reasoning trace.

---

## README questions

**1. What does the delta between `processed_at` and `confirmed_at` tell you about
network health at the time of submission?**

`processed` means a node has seen and voted on the slot; `confirmed` means a
supermajority (66%+ of stake) has voted on it. The delta is therefore the time it
takes votes to propagate and a supermajority to form on top of your transaction's
slot. A small, stable delta means votes are flowing freely and the cluster is
healthy. A widening delta signals congestion, fork contention, or degraded vote
propagation — the network is under stress and landing is less certain. Photon
records this delta on every bundle so the number reflects the cluster at the
exact moment of submission, not a general estimate.

**2. Why should you never use `finalized` commitment when fetching a blockhash
for a time-sensitive transaction?**

A blockhash is only valid for 150 slots (~60–90s). A `finalized` blockhash is
already ~31+ slots / ~13s old the moment you receive it, so you start with a
fraction of the validity window already burned — dramatically raising the chance
of an `expired_blockhash` failure before the bundle can land. `confirmed` is only
a slot or two behind the tip with negligible rollback risk, giving you almost the
full window. Photon's builder always fetches at `confirmed`.

**3. What happens to your bundle if the Jito leader skips their slot?**

It does not land and it does not roll over. A bundle is only valid for the leader
the Block Engine routes it to; if that leader skips their slot, the bundle is
simply not included, and there is no automatic forwarding to the next leader. You
will never receive a `processed` event for it. Photon detects this via the
lifecycle watchdog (nothing lands inside the validity window), classifies it, and
the agent decides to resubmit targeting the next scheduled Jito leader window
rather than waiting on a bundle that can never land.
