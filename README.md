# Photon — Smart Transaction Stack

A smart Solana transaction stack. Photon streams the network over Yellowstone
gRPC, submits transactions as Jito bundles, tracks every bundle across all
commitment levels, and lets a single-model Gemini agent own the tip decision and
the reasoning behind every failure. Everything is persisted to Postgres and
streamed live to an operator dashboard.

Architecture and design: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What it does

- **Dual-provider stream racing**: two Yellowstone gRPC providers raced first-event-wins with cross-provider dedup, per-provider reconnect loops, a staleness watchdog for half-open streams, and live win/delta telemetry. Runs fine on one provider.
- **Zero-RPC hot path**: the recent blockhash comes from streamed `blockMeta` (RPC only as cold-start fallback), and the leader schedule is held locally — `submit` makes no RPC calls once the cache is warm.
- **Precise expiry**: `expired_blockhash` is only assigned when the chain's block height actually passes the bundle's `lastValidBlockHeight`. A wall-clock timeout with a still-valid hash triggers a one-shot `getBundleStatuses` check and settles as `bundle_dropped` or `leader_skipped` instead.
- **Multi-region Jito submission**: `sendBundle` fans out to Frankfurt/Amsterdam/London concurrently, first success wins, with per-engine 429 cooldowns.
- **Local tip engine**: live tip observations from all 8 tip accounts (we already stream them) give local percentiles; a Holt double-exponential forecaster predicts the tip floor at expected landing time and feeds the agent.
- **Lifecycle tracking** of every transaction through `submitted → processed → confirmed → finalized`, with real latency deltas at each stage.
- **Typed failure classification** and an **autonomous recovery** path: the agent reasons with `blockhashStillValid`, `landedPerBundleStatus`, and `targetLeaderSkipped`; `hold` is real (re-evaluates when the leader window opens) and `refreshBlockhash: false` is honored when the hash is provably still live.
- **Fault injection** (`fault`: expired blockhash, `fault2`: minimum tip) to demonstrate two distinct failure classes deterministically.
- **Postgres** persistence (`lifecycles`, `decisions`) plus a JSONL export, and a **realtime SSE API** the dashboard renders.
- **No private key on the server** — the backend builds unsigned bundles; the dashboard wallet signs them.

## Repository layout

```
src/
  adapters/   network edge: yellowstone (gRPC), jito, rpc, gemini, signer
  core/       pure logic: leader, tip-oracle, builder, lifecycle, classifier, worker, submission
  agent/      AI layer behind a single DecisionPort
  api/        node:http SSE firehose + REST surface
  db/         drizzle schema, client, store (Postgres + JSONL export)
  shared/     types, ports, event bus, logging
drizzle/      generated migrations
test/         unit + API integration tests
web/          Next.js operator dashboard
```

---

## Prerequisites

- **Node.js >= 20**
- **Docker** (for local Postgres; or point `DATABASE_URL` at any Postgres)
- Provider accounts (free tiers are sufficient):
  - **Helius** — Solana JSON-RPC (free tier). https://helius.dev
  - **solinfra.dev** — Yellowstone/Geyser gRPC, pay-as-you-go ($0.08/GB). https://solinfra.dev
  - **Google AI Studio** — a Gemini API key. https://aistudio.google.com

## Install — backend

```bash
# 1. install dependencies
npm install

# 2. configure environment
cp .env.example .env        # then fill in the values (see table below)

# 3. start Postgres and apply the schema
docker compose up -d db
npm run db:migrate

# 4. verify
npm run typecheck
npm test
```

### Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `RPC_URL` | yes | Solana mainnet JSON-RPC (Helius free tier). |
| `GRPC_URL` | yes | Primary Yellowstone gRPC endpoint (SolInfra). |
| `GRPC_TOKEN` | — | Auth token for the primary gRPC endpoint. |
| `GRPC_URL_2` | — | Optional second Yellowstone endpoint (e.g. Helius LaserStream). When set, both providers are raced first-event-wins; when empty everything runs single-provider. |
| `GRPC_TOKEN_2` | — | Auth token for the second gRPC endpoint. |
| `JITO_ENGINES` | — | Comma-separated Jito Block Engine base URLs (default Frankfurt+Amsterdam+London). `sendBundle` fans out to all of them. `JITO_ENGINE` (single) is still honored. |
| `OPENROUTER_API_KEY` | yes* | OpenRouter key. If set, OpenRouter is used for the agent. |
| `OPENROUTER_MODEL` | — | Comma-separated model fallback chain (default `meta-llama/llama-3.3-70b-instruct:free`). Each model gets two tries before the next takes over — free tiers flake. |
| `GEMINI_API_KEY` | yes* | Gemini key. Used only if `OPENROUTER_API_KEY` is empty. |
| `GEMINI_MODEL` | — | Model id (default `gemini-2.0-flash`). |

\* The agent needs **one** LLM provider — set either `OPENROUTER_API_KEY` or `GEMINI_API_KEY` (not needed for `construct`).
| `WATCH_ACCOUNT` | yes | Account whose transactions validate the lifecycle tracker. The stream additionally always watches the wallet and all 8 Jito tip accounts, so our own bundles are observed no matter which tip account the builder picked. |
| `DATABASE_URL` | yes | Postgres connection string. |
| `TIP_CEILING_LAMPORTS` | — | Hard cap on the agent's tip (default 200000). |
| `PORT` | — | API server port for `serve` mode (default 8080). |
| `WALLET_PUBKEY` | — | Public key only, for `npm run construct`. No private key. |
| `WALLET_SECRET` | — | Optional **throwaway** key for local `submit`/`fault` testing only. Never your real wallet. |

### Run modes

```bash
npm run serve      # worker + realtime API (what the dashboard connects to)
npm start          # headless observe: stream, track lifecycles, run the agent
npm run construct  # build one unsigned bundle (needs WALLET_PUBKEY only)
npm test           # unit + API integration tests
```

Production signing happens client-side via the dashboard wallet. For local
end-to-end testing only, set a **throwaway** `WALLET_SECRET` and run:

```bash
npm run submit     # 10 real bundles, tracked to finalization (the judge artifact run)
npm run fault      # inject an expired blockhash -> expired_blockhash + agent recovery
npm run fault2     # submit with tip=1000 (Jito minimum) -> realistic non-landing ->
                   # bundle_dropped / leader_skipped + the agent's raise-tip reasoning
```

Sealed lifecycles and every agent decision are written to Postgres
(`lifecycles`, `decisions`) and appended to `logs/lifecycle/<date>.jsonl`. Every
JSONL row carries: signature, bundleId, tip, `blockhashSource` (stream/rpc),
`lastValidBlockHeight`, per-stage `{slot, at}`, latency deltas
(submitted→processed, processed→confirmed, confirmed→finalized, in ms), the
failure class, `retryOf`, the agent's reasoning + confidence, and the
stream-race winner counts at settle time. Slot numbers are explorer-verifiable.

### Failure classes

| Class | Meaning | How it is detected |
|---|---|---|
| `expired_blockhash` | The blockhash genuinely died before landing. | Chain block height (streamed `blockMeta`) passed the bundle's `lastValidBlockHeight`. Never assigned on wall clock alone. |
| `bundle_dropped` | The engine accepted the bundle but it never landed. | TTL passed with a still-valid hash; one-shot `getBundleStatuses` says not landed and the targeted leader window has passed. |
| `leader_skipped` | The targeted Jito leader skipped their slots. | None of the target window's slot numbers ever reached `confirmed` while later slots did. |
| `send_rejected` | Every Jito engine rejected `sendBundle`. | Settled immediately at submit time (no zombie TTL); routed straight to the recovery agent. |
| `fee_too_low` | Insufficient funds / account for fees. | Transaction error from the stream. |
| `compute_exceeded` | Compute budget exceeded. | Transaction error from the stream. |
| `unknown` | Anything else (e.g. status said landed but the stream never confirmed). | Fallback. |

## Install — dashboard

```bash
cd web
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE (default http://localhost:8080)
npm run dev                  # http://localhost:3000  (expects the backend in serve mode)
```

The dashboard is a terminal-style "signal deck", built strictly for the
searcher (no third-party transaction noise): a rolling slot odometer and epoch
hairline up top; hero numerals on the left (AI tip, land rate, forecast trend,
session tip spend, stream race); the live **tip surface** in the middle —
crimson tip floor, amber agent tip steps, dashed Holt forecast past the "now"
line, with every policy decision pinned to the chart as a hoverable node; the
**Jito windows table** below it — the next 10 leader windows counting down
live, each row clickable for the validator behind it (stake, commission, MEV
fee, explorer links); **your bundles** lanes animate your own submissions
through submitted → processed → confirmed → finalized, with the agent's
recovery verdict growing out of a failed lane; and the launch dock carries
**turbo mode** (streamed tip-of-chain blockhash vs safe RPC confirmed),
**preflight simulation**, and a **fire-timing countdown** that pulses green
when the Jito window is open. The agent's reasoning types out live in the
stdout bar at the bottom. Connect a wallet to submit: the frontend calls
`/bundle/prepare`, the wallet signs, preflight simulates, and the signed
transaction posts to `/bundle/submit`.

### API reference (serve mode)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + whether a server signer is present |
| GET | `/events` | SSE firehose: `slot`, `lifecycle`, `tip_policy`, `agent`, `stream`, `stream_race`, `leader`, `network` |
| GET | `/leaders` | The next 10 Jito leader windows (slot range, ETA, validator identity/stake/MEV commission), derived locally |
| GET | `/engines` | Per-region block-engine RTT from the background probe |
| POST | `/bundle/prepare` | `{ payer, tip?, turbo? }` → unsigned bundle. `turbo: true` signs against the freshest streamed tip-of-chain blockhash; default is RPC `confirmed` (safe) |
| POST | `/bundle/simulate` | `{ signedTx }` → preflight `simulateTransaction`; a bundle that would fail on-chain is caught before a tip is risked |
| POST | `/bundle/submit` | `{ signedTx, signature, tip }` → submits to Jito and tracks it |
| POST | `/fault` | Inject a blockhash-expiry failure (local-signer demo only) |

Note on the leader schedule: `getNextScheduledLeader` exists only on Jito's
gRPC searcher API (the HTTP block engines 404 it), so Photon derives every
upcoming Jito window locally — `getSlotLeaders` × the Kobe validator set —
which is faster, free, and gives the full firing schedule instead of one
anchor.

---

## Stream racing

`MultiStream` wraps one `Yellowstone` leg per provider (SolInfra primary,
Helius LaserStream via `GRPC_URL_2`). Every event is deduped first-event-wins:

- **Dedup keys**: `slot:commitment` (LRU 2048), tx signature / tip signature
  (LRU 8192), block slot. Fixed-size key rings — nothing unbounded, the
  process runs for hours.
- **Scoring**: the first provider to deliver an event gets a win; the
  duplicate increments the loser's losses and records `recvAt - firstAt` into
  the winner's delta ring (512 samples) for p50/p99 lead-time.
- **Watchdog**: every 2 s, a provider silent for 5 s while the other is
  flowing gets its stream force-cancelled to break half-open gRPC connections
  — the #1 silent failure mode. Providers reconnect independently
  (500 ms → 15 s backoff, 0–250 ms jitter); one being down never gaps the other.
- **Telemetry**: every 5 s the bus (and SSE `/events`) carries
  `stream_race`:

```json
{ "type": "stream_race",
  "providers": [
    { "name": "fra.grpc.solinfra.dev", "wins": 41210, "losses": 2874,
      "p50DeltaMs": 9, "p99DeltaMs": 42, "reconnects": 0,
      "connected": true, "lastEventAgoMs": 12 },
    { "name": "laserstream-mainnet-fra.helius-rpc.com", "wins": 2874, "losses": 41210,
      "p50DeltaMs": 6, "p99DeltaMs": 31, "reconnects": 1,
      "connected": true, "lastEventAgoMs": 20 } ],
  "dropped": 0, "droppedDelta": 0 }
```

The numbers above are the shape of the payload (illustrative values); run
`npm start` with both providers configured and read the real win/delta split
for your regions off the `stream_race` events or the dashboard. Each settled
lifecycle's JSONL row also snapshots the winner counts at settle time.

---

## README questions

**1. What does the delta between `processed_at` and `confirmed_at` tell you about
network health at the time of submission?**

`processed` means a node has seen and voted on the slot; `confirmed` means a
supermajority (66%+ of stake) has voted on it. The delta is therefore the time it
takes votes to propagate and a supermajority to form on top of that slot. A
small, stable delta means votes are flowing freely and the cluster is healthy. A
widening delta signals congestion, fork contention, or degraded vote propagation
— the network is under stress and landing is less certain. Photon records this
delta on every tracked transaction (and surfaces it live as "network health"), so
the number reflects the cluster at that exact moment, not a general estimate.
With dual-provider racing the timestamps come from whichever provider delivered
each slot event first, so the deltas in `logs/lifecycle/*.jsonl`
(`processed_to_confirmed_ms`, `confirmed_to_finalized_ms`) are the tightest
observation either stream could give us at that moment.

**2. Why should you never use `finalized` commitment when fetching a blockhash
for a time-sensitive transaction?**

A blockhash is valid for 150 blocks after the block that produced it
(`BLOCKHASH_VALID_BLOCKS` in `src/core/constants.ts`). A `finalized` blockhash
is already ~31+ slots / ~13s old the moment you receive it, so you start with a
fraction of the validity window already burned — sharply raising the chance of an
`expired_blockhash` failure before the bundle can land. Photon goes one step
further than fetching at `confirmed`: the builder signs against the blockhash
streamed in the latest `blockMeta` event (`blockhashSource: "stream"` in the
lifecycle log), which is as close to the tip as it is possible to be, and the
tracker knows the exact `lastValidBlockHeight` — so expiry is measured against
the chain's real block height, not a wall-clock guess. In our lifecycle logs,
an unobserved bundle whose hash is still within its 150-block budget is never
called expired; it goes through the `bundleStatus` check and settles as the
drop it actually is.

**3. What happens to your bundle if the Jito leader skips their slot?**

It does not land and it does not roll over. A bundle is only valid for the leader
the Block Engine routes it to; if that leader skips their slot, the bundle is
simply not included, and there is no automatic forwarding to the next leader. You
never receive a `processed` event for it. Photon observes this directly: it
records the targeted leader window at submit time, and when the streamed slots
show the chain confirming slots *beyond* the window while none of the window's
own slot numbers ever reached `confirmed`, the lifecycle settles as
`leader_skipped` (with `targetLeaderSkipped: true` handed to the recovery
agent). The agent's playbook for that class is to resubmit into the next
scheduled Jito window — the tip was not the problem, the leader was — which is
exactly what the `hold` action does when the window is still ahead.

---

## Project status

Built: dual-provider stream racing, the zero-RPC hot path (streamed blockhash +
local leader schedule), precise expiry with reachable `bundle_dropped` /
`leader_skipped` / `send_rejected` classes, the local tip engine + forecaster,
multi-region Jito submission, lifecycle tracking, the tip/recovery agent,
Postgres + JSONL persistence, the realtime API, graceful shutdown, and the
operator dashboard. Pending: a funded mainnet run (`npm run submit`, 10 runs)
via a throwaway wallet, which produces the explorer-verifiable lifecycle logs
and real stream-race win/delta numbers for the section above.
