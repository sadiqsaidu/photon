# Photon — Smart Transaction Stack

Backend of a smart Solana transaction stack. It streams the network over
Yellowstone gRPC, tracks transactions across every commitment level, and lets a
single-model Gemini agent own the tip decision and the reasoning behind every
failure. Everything is persisted to Postgres.

Built in two phases:

- **Phase 1 (now):** observation + decision backend. No wallet, no signing, no
  private key on the server. Streams live data, proves the lifecycle tracker on
  real on-chain transactions, runs the agent, persists to Postgres + JSONL.
- **Phase 2:** dashboard with a client-side wallet connector. The backend builds
  unsigned bundles, the browser wallet signs, the backend submits to Jito and
  tracks its own bundles. The `build → sign → submit` seams already exist.

Architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Layout

```
src/
  adapters/   network edge: yellowstone (gRPC), jito, rpc, gemini
  core/       pure logic: leader, tip-oracle, builder, lifecycle, classifier, worker
  agent/      AI layer behind a single DecisionPort
  db/         drizzle schema, client, store (Postgres + JSONL export)
  shared/     types, ports, logging
drizzle/      generated migrations
```

The agent only ever sees a typed `DecisionPort` — the sole contact point between
the AI layer and the transaction stack.

## Setup

Requires Node >= 20 and Docker (for local Postgres).

```bash
npm install
cp .env.example .env          # fill RPC_URL, GRPC_URL/GRPC_TOKEN, GEMINI_API_KEY
docker compose up -d db       # local Postgres
npm run db:migrate            # apply schema
npm run typecheck
```

- **RPC_URL** — Helius free tier.
- **GRPC_URL / GRPC_TOKEN** — solinfra.dev Yellowstone gRPC (pay-as-you-go).
- **GEMINI_API_KEY / GEMINI_MODEL** — Google AI Studio; one model for the agent.
- **WATCH_ACCOUNT** — the account whose transactions validate the lifecycle
  tracker. Defaults to a Jito tip account. Higher volume = more GB streamed.
- **DATABASE_URL** — Postgres connection string.
- **WALLET_PUBKEY** — public key only, for the build-unsigned demo. No private key.

## Run

```bash
npm start            # observe: stream, track lifecycles, run the tip + failure agent
npm run construct    # build one unsigned bundle (signing happens client-side later)
npm test             # unit tests: classifier, lifecycle, agent, submission
```

The submission core (`build → sign → submit → track → autonomous retry → fault
injection`) is implemented behind the `Signer` port. Production signing happens
client-side via the dashboard wallet; for local end-to-end testing only you may
set a **throwaway** `WALLET_SECRET` and run:

```bash
npm run submit       # submit real bundles and track them to finalization
npm run fault        # inject a blockhash expiry; the agent recovers autonomously
```

## Dashboard

An operator-console dashboard lives in [`web/`](./web) (Next.js). It connects to
the `serve`-mode SSE firehose and renders the live transaction journey, the
bundle-flow animation, the agent's reasoning, and a wallet-connector submit flow.

```bash
cd web && npm install && npm run dev   # expects the backend on :8080
```

## Realtime API (serve mode)

```bash
npm run serve        # run the worker + HTTP API (default port 8080)
```

The dashboard consumes this. Signing stays client-side: the frontend calls
`/bundle/prepare` to get an unsigned bundle, the wallet signs it, and the
frontend posts the signed transaction to `/bundle/submit`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + whether a server signer is present |
| GET | `/events` | SSE firehose: `slot`, `lifecycle`, `tip_policy`, `agent`, `stream` events |
| POST | `/bundle/prepare` | `{ payer, tip? }` → unsigned bundle for the wallet to sign |
| POST | `/bundle/submit` | `{ signedTx, signature, tip }` → submits to Jito and tracks it |
| POST | `/fault` | Inject a blockhash-expiry failure (local-signer demo only) |

The observer follows live transactions through `processed → confirmed →
finalized`, records real latency deltas, and runs the agent continuously. Sealed
lifecycles and every agent decision are written to Postgres (`lifecycles`,
`decisions` tables) and appended to `logs/lifecycle/<date>.jsonl`.

> Phase 1 does not submit our own bundles, so the bounty's funded-submission
> lifecycle logs land in phase 2 once the wallet connector exists. Phase 1 proves
> the streaming, lifecycle, and AI machinery on real mainnet data without holding
> a key.

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
delta on every tracked transaction, so the number reflects the cluster at that
exact moment, not a general estimate.

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
