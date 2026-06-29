# Photon — Smart Transaction Stack

A smart Solana transaction stack. Photon streams the network over Yellowstone
gRPC, submits transactions as Jito bundles, tracks every bundle across all
commitment levels, and lets a single-model Gemini agent own the tip decision and
the reasoning behind every failure. Everything is persisted to Postgres and
streamed live to an operator dashboard.

Architecture and design: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What it does

- **Live streaming** over Yellowstone gRPC with reconnection and backpressure handling.
- **Lifecycle tracking** of every transaction through `submitted → processed → confirmed → finalized`, with real latency deltas at each stage.
- **Jito bundles** with **dynamic tips** derived from the live Jito tip floor by an AI agent — no hardcoded values.
- **Typed failure classification** and an **autonomous recovery** path: on failure the agent reasons about the cause and decides what to change before retrying.
- **Blockhash-expiry fault injection** to demonstrate the recovery loop on demand.
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
| `GRPC_URL` | yes | Yellowstone gRPC endpoint (solinfra.dev). |
| `GRPC_TOKEN` | — | Auth token for the gRPC endpoint. |
| `OPENROUTER_API_KEY` | yes* | OpenRouter key. If set, OpenRouter is used for the agent. |
| `OPENROUTER_MODEL` | — | Model id (default `meta-llama/llama-3.3-70b-instruct:free`; any `:free` model works). |
| `GEMINI_API_KEY` | yes* | Gemini key. Used only if `OPENROUTER_API_KEY` is empty. |
| `GEMINI_MODEL` | — | Model id (default `gemini-2.0-flash`). |

\* The agent needs **one** LLM provider — set either `OPENROUTER_API_KEY` or `GEMINI_API_KEY` (not needed for `construct`).
| `WATCH_ACCOUNT` | yes | Account whose transactions validate the lifecycle tracker. Defaults to a Jito tip account. Higher volume = more GB streamed. |
| `DATABASE_URL` | yes | Postgres connection string. |
| `JITO_ENGINE` | — | Jito Block Engine base URL (default Frankfurt). |
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
npm run submit     # submit real bundles and track them to finalization
npm run fault      # inject a blockhash expiry; the agent recovers autonomously
```

Sealed lifecycles and every agent decision are written to Postgres
(`lifecycles`, `decisions`) and appended to `logs/lifecycle/<date>.jsonl`.

## Install — dashboard

```bash
cd web
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE (default http://localhost:8080)
npm run dev                  # http://localhost:3000  (expects the backend in serve mode)
```

The dashboard renders the live transaction journey, the bundle-flow animation,
the agent's reasoning feed, and a wallet-connector submit flow. Connect a wallet
to submit: the frontend calls `/bundle/prepare`, the wallet signs, and the
frontend posts the signed transaction to `/bundle/submit`.

### API reference (serve mode)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + whether a server signer is present |
| GET | `/events` | SSE firehose: `slot`, `lifecycle`, `tip_policy`, `agent`, `stream` |
| POST | `/bundle/prepare` | `{ payer, tip? }` → unsigned bundle for the wallet to sign |
| POST | `/bundle/submit` | `{ signedTx, signature, tip }` → submits to Jito and tracks it |
| POST | `/fault` | Inject a blockhash-expiry failure (local-signer demo only) |

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

**2. Why should you never use `finalized` commitment when fetching a blockhash
for a time-sensitive transaction?**

A blockhash is only valid for 150 slots (~60–90s). A `finalized` blockhash is
already ~31+ slots / ~13s old the moment you receive it, so you start with a
fraction of the validity window already burned — sharply raising the chance of an
`expired_blockhash` failure before the bundle can land. `confirmed` is only a
slot or two behind the tip with negligible rollback risk, giving you almost the
full window. Photon's builder always fetches at `confirmed`.

**3. What happens to your bundle if the Jito leader skips their slot?**

It does not land and it does not roll over. A bundle is only valid for the leader
the Block Engine routes it to; if that leader skips their slot, the bundle is
simply not included, and there is no automatic forwarding to the next leader. You
never receive a `processed` event for it. The right response is to detect the
non-inclusion and resubmit targeting the next scheduled Jito leader window rather
than waiting on a bundle that can never land.

---

## Project status

Built: streaming, lifecycle tracking, the tip/recovery agent, Postgres
persistence, the submission core (build/sign/submit/track/retry/fault) behind the
`Signer` port, the realtime API, and the operator dashboard. Pending: a funded
mainnet run via the wallet connector, which produces the explorer-verifiable
lifecycle logs.
