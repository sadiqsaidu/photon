# Photon

**A Solana tip oracle with receipts.** Every bot guesses its tip. Photon turns the guess into a quote, sends through Solami Beam, and proves the quote was right.

Landing a transaction on Solana means paying a tip on top of the fee, and nobody tells you how much is enough. Bots hardcode a number, overpay when the chain is quiet and lose the race when it is busy. Photon measures every landed tip in every slot from a Yellowstone gRPC stream, prices a tip for a deadline and a confidence you choose, sends through Beam, follows the transaction to finalized, and keeps score of how often its predictions were right.

## A real user story

A solo developer runs a bot that buys tokens right after a pump.fun graduation, with a hardcoded tip of 0.002 SOL. Photon's Tip Audit shows that during quiet periods the tip sat far above the median landed tip of its slot (money left on the table), and during the busiest launches it fell below the slot's 25th percentile (lost races). The developer replaces the constant with `quote()` and `send()`: the tip now follows the live market, every send comes back with a receipt, and the dashboard shows whether the predicted landing probability held up.

## What it does

1. **Quote and send SDK.** `quote({ deadlineSlots, confidence })` returns a tip in lamports, a priority fee, the predicted probability of landing within the deadline, and whether the landing model is calibrated yet. `send(signedTx)` submits through Beam, tracks the transaction through processed, confirmed and finalized, and returns a receipt with the landed slot, per-stage latency, the Beam landing record, or a typed failure class.
2. **Tip Audit.** Enter any wallet. Photon pulls its recent transactions, finds the tip each one paid, compares it with the tips that landed in the same slot, and reports total tips, estimated overpay and underpaid transactions. "Watch live" registers the wallet on a Solami webhook and updates the audit as new transactions land.
3. **Block-space weather dashboard.** Live per-slot tip surface with a forecast, Blur market heat on an aligned strip, the measured lead or lag between heat and tips, a live quote widget, a calibration chart, probe lanes, upcoming leaders, and stream health (bandwidth, queue depth, reconnects, backpressure closures).

## How Solami is used

| Product | What Photon does with it |
| --- | --- |
| Yellowstone gRPC | One subscription: slots (processed, confirmed, finalized), block meta (blockhash and block height), every successful transaction touching any of the 8 Jito tip accounts or the 15 Beam tip addresses (the landed tip distribution per slot, and lifecycle tracking for Photon's own sends), and status-only updates for failed transactions touching Beam tip addresses (`failed_onchain`). Reconnects resume with `from_slot`. Updates pass through a bounded queue so a slow moment never backs up Solami's server-side buffer. |
| Mirage | The same slot stream over a plain WebSocket (a saved Mirage subscription), raced against gRPC: wins per source and the median lead. |
| Blur (WebSocket) | Decoded market events: swaps of $100 or more, token creations, pool creations, graduations and surges, weighted into a per-slot heat signal. |
| Beam | Every probe and every SDK send goes out as `sendTransaction` on Solami RPC with a transfer to a Beam tip address, which routes it through Beam. Tip addresses come from `GET /onchain/tip-addresses`; each receipt carries the landing record from `GET /swqos/tx/{signature}`. |
| RPC | `getSlotLeaders` (leader table), `getRecentPrioritizationFees` (priority fee), `getLatestBlockhash` (fallback), `getSignatureStatuses` (expiry double check and restart recovery), `getBlock` (audit benchmarks for slots Photon did not stream), `getTransaction`, `getBalance`. |
| Data API | `getTransactionsForAddress` (Solami's paginated wallet history RPC method) for the audit, falling back to `getSignaturesForAddress` plus `getTransaction`; `GET /data/token/price` for the SOL price in USD. |
| Webhooks | One stream-mode webhook (enriched transfer events) for every watched wallet, consumed over `wss://{region}.ws.solami.dev/webhooks/stream/{id}`; HTTP delivery with HMAC verification is supported when a public URL is configured. |
| Leader tracking | `GET /leader-tracking/current` every 2 s: the chain tip, so the dashboard shows how many slots the stream is behind. |

## Quick start

Requires Node 20.12 or newer and Docker (or any Postgres 14+).

```bash
git clone https://github.com/sadiqsaidu/photon.git
cd photon
npm install
cp .env.example .env          # add SOLAMI_API_KEY, optionally PROBE_SECRET
docker compose up -d db
npm run db:migrate            # optional: the server also migrates at startup
npm run doctor                # checks every Solami product with your key
npm run serve                 # API and streams on http://localhost:8080
```

Then the dashboard:

```bash
cd web
npm install
cp .env.example .env.local    # NEXT_PUBLIC_API_BASE=http://localhost:8080
npm run dev                   # http://localhost:3000
```

## Getting a key

Sign up at https://solami.dev/signup?ref=st-earn-sep-26. The Pro trial covers everything Photon uses.

Create a standard API key (`sk_...`) in the dashboard and give it a role with these permissions:

- RPC and gRPC access (included with the plan)
- `DataApi` (Blur stream and price)
- `MirageView`, `MirageManage`, `MirageStream`
- `WebhooksView`, `WebhooksManage`, `WebhooksStream`

Beam over RPC needs no separate swQoS key. Put the key in `SOLAMI_API_KEY` and pick the region closest to your server with `SOLAMI_REGION` (`ams`, `fra`, `nyc`, or `global` for the nearest node). `npm run doctor` prints a table of every product with the exact error for anything your key cannot reach.

## Environment variables

| Name | Required | Default | Meaning |
| --- | --- | --- | --- |
| `SOLAMI_API_KEY` | yes | | Solami standard API key. |
| `SOLAMI_REGION` | no | `ams` | `ams`, `fra`, `nyc` or `global`. Prefixes every Solami hostname. |
| `DATABASE_URL` | no | `postgres://photon:photon@localhost:5432/photon` | Postgres URL. `?sslmode=require` encrypts without verifying the certificate (Supabase); `verify-full` verifies. |
| `PORT` | no | `8080` | HTTP port (binds 0.0.0.0). |
| `PROBE_SECRET` | no | | Base58 secret key of a funded burner wallet. Enables probes and `npm run demo`. |
| `PROBE_INTERVAL_SEC` | no | `60` | Seconds between probes. |
| `PROBE_BUDGET_SOL` | no | `0.05` | Total SOL probes may ever spend (tracked in Postgres). Also capped by the wallet balance minus a rent reserve. |
| `PROBE_LIMIT` | no | `0` | Max probes one process sends; 0 means until calibrated or out of budget. |
| `TIP_CEILING_LAMPORTS` | no | `1000000` | Highest tip Photon will quote or probe. |
| `AUDIT_MAX_BLOCKS` | no | `40` | Max `getBlock` calls per audit for slots without stored stats. |
| `WEBHOOK_PUBLIC_URL` | no | | Public base URL of this server. When set, webhooks also POST to `/webhooks/solami` (HMAC verified). |
| `NEXT_PUBLIC_API_BASE` | web | `http://localhost:8080` | Backend URL for the dashboard (`web/.env.local`). |

## Run modes

| Command | What it does |
| --- | --- |
| `npm run serve` | Streams, probes, API and SSE (TypeScript via tsx). |
| `npm run build && npm start` | The same server compiled to `dist/` (production). |
| `npm run doctor` | Calls every Solami product with your key and prints reachable or unreachable with the exact error. |
| `npm run demo` | Uses `PROBE_SECRET` to build a self transfer with a memo, quotes deadline 2 at confidence 0.9, sends through a running server, waits for the receipt and prints it with a Solscan link. |
| `npm test` | Unit tests: quote and landing model, forecast and lag, audit math, failure classes. |
| `npm run typecheck` | TypeScript strict check. |

## SDK

`src/sdk.ts` depends only on `@solana/web3.js` and runs in Node or the browser.

```ts
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createPhoton } from "./sdk.js";

const photon = createPhoton("https://your-photon-host");
const quote = await photon.quote({ deadlineSlots: 2, confidence: 0.9 });

const message = new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: quote.priorityFeeMicroLamports }),
    ...yourInstructions,
    await photon.tipInstruction(wallet.publicKey, quote.tipLamports),
  ],
}).compileToV0Message();
const tx = new VersionedTransaction(message);
tx.sign([wallet]);

const signature = await photon.send(tx);
const receipt = await photon.waitForReceipt(signature);
console.log(receipt.failure ?? `landed in slot ${receipt.landedSlot}`, receipt.stages, receipt.beam);
```

## API

| Method and path | Returns |
| --- | --- |
| `GET /health` | Stream health (connected, bytes, reconnects, backpressure closures, queue depth), slots behind and the maximum, degraded features. In memory, cheap. |
| `GET /events` | Server-sent events: `slot`, `tips`, `heat`, `lag`, `quote`, `probe`, `lifecycle`, `stream`, `audit`. Heartbeat every 15 s. |
| `GET /stats` | Snapshot for the dashboard's first paint. |
| `GET /quote?deadline=2&confidence=0.9` | Tip, priority fee, probability, `meetsConfidence`, `calibrated`, per-bucket status. |
| `GET /tips/addresses` | Beam tip addresses and Jito tip accounts. |
| `POST /send` | Body `{ "tx": "<base64 signed transaction>" }`. Returns `{ "signature" }`. The transaction must carry at least 100,000 lamports to a Beam tip address. |
| `GET /receipt/:signature` | Stages with slot and ms, landed slot, failure class, Beam landing record, `settled`. |
| `GET /calibration` | Per bucket predicted vs actual, model probability, status, Brier score. |
| `GET /leaders` | Next 20 slots of leaders with slots seen, median tip, probes landed, skipped slots. |
| `POST /audit` | Body `{ "address", "limit" }` (limit 1 to 300, default 100). Runs and stores an audit. |
| `GET /audit/:address` | The stored audit. |
| `POST /audit/:address/watch` | Adds the wallet to the live webhook stream. |
| `POST /webhooks/solami` | HTTP webhook delivery (only when `WEBHOOK_PUBLIC_URL` is set). |

The Solami key never leaves the server.

## Methodology

**Tips.** For every successful transaction that touches a tip account, the tip is the post balance minus the pre balance of that account (lookup-table loaded accounts included). Tips are grouped by slot; when gRPC reports the slot confirmed, Photon computes count, p25, p50, p75, p90 and max, keeps the last 600 slots in memory, and writes one row per finalized slot to Postgres (batched every 2 s). Tips are tagged `jito` or `beam`.

**The Beam floor.** Beam rejects tips below 100,000 lamports, which sits around the 90th percentile of all landed tips. Quotes therefore price inside the tips a Beam send could actually pay: landed tips at or above the floor (from Beam tips alone once there are 200 in the window). The API and dashboard show where the floor sits in the full distribution.

**Heat and the lag test.** Each Blur event adds to its slot's heat (swap 1, token creation 3, pool creation 5, surge 5, graduation 10); events without a slot use the latest processed slot. Heat counts swaps of $100 or more, which cuts Blur bandwidth by about 85%. Every 30 s Photon computes the Pearson correlation between heat at slot t and tip p75 at slot t+k for k from 0 to 20 over the last 900 slots, and publishes the best k and r. The forecast uses heat only when r is at least 0.2 and k at least 1. The dashboard shows the result either way, including "no lead detected".

**Forecast.** Holt double exponential smoothing on per-slot p50 and p90, projected h slots ahead. When the heat signal qualifies, the projection is multiplied by `1 + beta * z(heat now)`, with beta fitted by least squares on the window and the multiplier clamped to [0.8, 2.0].

**Landing model and quote.** Every probe records its tip, the tip's percentile in the distribution at send time, the predicted probability, and the slots from send to land. Probes fall into five percentile buckets (0 to 25, 25 to 50, 50 to 75, 75 to 90, 90 to 100). For a deadline D, P(bucket) = (landed within D + 1) / (n + 2), made non-decreasing across buckets. A bucket is reachable when some tip at or below `TIP_CEILING_LAMPORTS` falls inside it; buckets above the ceiling are reported as "above tip ceiling" and never quoted or probed. The quote is the cheapest reachable bucket whose probability meets the requested confidence, priced at the forecast of that bucket's upper percentile h = D slots ahead, floored at the Beam minimum and capped at the ceiling. If none qualifies, the top reachable bucket is returned with its real probability and `meetsConfidence: false`. Until every reachable bucket has 10 probes, Photon uses priors (0.5, 0.65, 0.8, 0.9, 0.95) and returns `calibrated: false`. The priority fee is p75 of `getRecentPrioritizationFees`, cached 10 s.

**Probes.** With `PROBE_SECRET` set, Photon sends one probe every `PROBE_INTERVAL_SEC`: a compute unit price, a `photon-probe` memo and a tip to a random Beam tip address. Each probe targets the least-sampled reachable bucket (ties at random) with the tip whose mid-rank falls inside that bucket, closest to its middle. Many tips are exactly 100,000 lamports, so a plain midpoint can land in the neighbouring bucket; the mid-rank search avoids that. Before the first send Photon simulates the whole run (every probe until each reachable bucket has 10, or `PROBE_LIMIT`) and does not start if its cost exceeds the budget left. Probing stops when the reachable buckets are full or the budget is spent; spend is stored in Postgres, so a restart cannot overspend.

**Failure classes.** `send_rejected`: Beam returned an error at send time. `failed_onchain`: the transaction landed with an error. `leader_skipped`: not landed before expiry, and one of the first 4 slots after the send never confirmed while a later slot did. `expired_blockhash`: not landed and the streamed block height passed the blockhash's last valid block height (never decided on wall clock). Before either of the last two, Photon makes one `getSignatureStatuses` check in case the stream missed the landing. After settling, the Beam landing record is attached to the receipt.

**Audit math.** For each transaction: tip paid is the sum of System transfers from the wallet to any Jito or Beam tip address (cross-program transfers included), priority fee is the fee minus 5,000 lamports per signature. The slot benchmark comes from stored slot stats, or from `getBlock` for slots Photon did not stream (concurrency 8, at most `AUDIT_MAX_BLOCKS` per audit). Overpay is `max(0, tip - slot p50)`; a transaction is underpaid when its tip is below the slot's p25. **Overpay is an estimate against the slot median**, not a claim that a smaller tip would have landed.

## Costs

**Probes.** A probe costs its tip plus a 5,020 lamport fee. At the default 60 s interval and tips between the Beam floor (100,000) and a 1,000,000 lamport ceiling, that is between 0.0063 and 0.06 SOL per hour. Probing is capped by `PROBE_BUDGET_SOL` and stops by itself once every reachable bucket has 10 probes. Filling the three reachable buckets from scratch costs roughly 0.004 to 0.01 SOL at the distribution measured in October 2026.

**Streams.** Measured over a 10 minute mainnet run (October 2026, ams region): gRPC 1.67 MB/s (full successful tip transactions; included in the Pro plan's gRPC streams), Blur 0.09 MB/s for swaps of $100+ plus 0.001 MB/s for launch-type events (Solami bills Blur at $0.20 per GB: about $1.60 to $1.90 per day), Mirage 0.001 MB/s, webhook stream about 0.01 to 0.03 MB/s per busy watched wallet.

**Server.** The API process used about 21% of one CPU core and about 280 MB of memory (V8 heap capped at 256 MB) with all streams up and no watched wallets.

## Mainnet proof

To be filled from the hosted instance after the live run:

| What | Value |
| --- | --- |
| Hosted dashboard | `TODO: Vercel URL` |
| Hosted API | `TODO: Render URL` |
| Probe signatures (hosted run) | `TODO: list with Solscan links` |
| Demo signature (hosted run) | `TODO` |
| Lag result | `TODO: best k and r over 900 slots` |
| Calibration | `TODO: per bucket predicted vs actual, Brier score, probe count` |

Additional proof from development (October 7, 2026, region ams, all sent through Beam via Solami RPC):

| Kind | Signature | Tip (lamports) | Slots to land | Beam record |
| --- | --- | --- | --- | --- |
| demo (SDK) | [2T1BfYu8...yzdvrt62](https://solscan.io/tx/2T1BfYu8NWLDscv7taLCHNBiqYHVasgUd5XTAuaBYpnTRxPuQ1v1tuEieU73h5mNQEAVS1Ao6kwReQH2yzdvrt62) | 1,000,000 | 2 | landed, ams |
| probe | [5zyHTy7M...ygF6nd2](https://solscan.io/tx/5zyHTy7MZmiaNKw7SHDvWEC41WrT5gcQUrfGPn7rur9R91zGzsFN9As8hbZk24oj3ogfTzCTiLiBs7vj6ygF6nd2) | 200,000 | 5 | landed, ams |
| probe | [2GhYQokN...zG3mDVun](https://solscan.io/tx/2GhYQokNAT46nyKkfN3uY1tFx96PWuQZBH6yZLKSCehHfPMR4fCaY5MZwtDWFMQFSqLCRk3r15hzVpBEzG3mDVun) | 100,010 | 5 | landed, ams |
| probe | [27BvrA3X...gCh73Yi](https://solscan.io/tx/27BvrA3XUt89gXSJKKtW3DdwrWcmdxdahZE3MhnZVFCQeDLAP6i2yjFRFTJzwjc6Eh3J7uvPdwb5BrpKSgCh73Yi) | 152,568 | 4 | landed, ams |
| probe | [n5XVjUB7...LQUrmhs6](https://solscan.io/tx/n5XVjUB7GtcoxjEqmy1ow2oRicwEJMZD3HAZD3UazwfkBy9ipRMEpC7K8McjKt3RCLK7kSmfhSpjXfMLQUrmhs6) | 300,000 | 4 | landed, ams |
| probe | [5TLp8vXz...hYpnTDQ](https://solscan.io/tx/5TLp8vXzeyfuE2nCWG2njhSrJ7vqyuHvwWXcKqNatFLQgkgw8DD2KkeghXCyhGp1x6K2HRJpYnrhEf1htQbo2bSC) | 202,600 | 6 | landed, ams |
| probe | [4JSieyYP...5TE7Y9](https://solscan.io/tx/4JSieyYPfVFananYRnNMxwbdafELJtfQdx8m39e67sujPwnKKfR3Nv1ECS2hhB9qMNW7zo3bVteUcoLsyd5TE7Y9) | 300,000 | 3 | landed, ams |
| probe | [4Us2119h...grhoYP](https://solscan.io/tx/4Us2119hxZeugEVz8SHsEHWSh5CeFLkYMDmcEyJYzRmU9HR2FuMFUaS8uYhFwGVjxFgDasrSoWRvEjJqxWgrhoYP) | 300,000 | 4 | landed, ams |
| probe | [32YWhxgV...xKh9VB](https://solscan.io/tx/32YWhxgVTibpK57aXgwxqAYw54QqxNx2v3AHfLEhZg8WRU8Cu6Rd99p5CSjma2SafW2MH1e9KmYQxQRTprxKh9VB) | 300,000 | 8 | landed, ams |
| probe | [5f12LWNU...o2eXnC](https://solscan.io/tx/5f12LWNUUf7kDoqgJVFrGajHbPy1jJWMa8MuxuG8jhPm8inn4YbK1k4kEUCeiA2ctGFM1x9H7w8Mm685s5o2eXnC) | 300,000 | 6 | landed, ams |
| probe | [25rZ9hc6...BL2edT](https://solscan.io/tx/25rZ9hc6wNwYJP3fBoYnC37QkqdoQ8tUshpciYoU8idw1f4G3TMZyUWAcXv6pMGxhtbJ4hX1EwzNVubSQFBL2edT) | 100,000 | 3 | landed, ams |
| probe | [4HtmVN7K...zfs7mj](https://solscan.io/tx/4HtmVN7K2FgY6tktGYkqC3u3pd36znd7PyhdjVsBM5betQF96bdXHSMiQW5irbwizmuPF34bQPJYQhHJyWzfs7mj) | 300,000 | 4 | landed, ams |
| probe | [Jq6zxMrm...arQzZz](https://solscan.io/tx/Jq6zxMrmgoieRVRCJYgAVHfftTfrXLiUtNo75MARz7vxxNSYd8ksoaXE54PkDKt6BjcMY1WpDDxB5PPsrarQzZz) | 100,000 | 2 | landed, ams |
| probe | [5DfmHEfi...VXmeiH](https://solscan.io/tx/5DfmHEfiQHDeL29K1hJAJmWT6FHxz9WmWPsD76CBjg6ezZ79w3q38r13uXdKa4n5gZXqFjF5dAYUWkz8HSVXmeiH) | 300,000 | 10 | landed, ams |
| probe | [47PeCypH...6EGET3](https://solscan.io/tx/47PeCypHFfMBWpDhaKPyxTcMQvMVHHj6R1yVSQU6wwW3dRyDPcgx95MtX8whaFsqaNRyH2jAVQsSwPjaBR6EGET3) | 300,000 | 1 | landed, ams |
| probe | [3JwRGA6p...DEbq7C](https://solscan.io/tx/3JwRGA6pfpKnDNSeGjB4nPBdZAxKZ7ALoLGLuRkqtwE6kakAf8ZpS17RhvGCTTA1GHXYwUv5QNTDM46PY4DEbq7C) | 300,000 | 3 | landed, ams |
| probe | [QnCsjtWH...4CsSVL](https://solscan.io/tx/QnCsjtWHkHwbAucBDKD3bSG7z4AMmBjRc1PrvPSDuE9YFM8hCuaJa1baWTgrNf2gnsJgPxxu4d5bsPH5p4CsSVL) | 300,000 | 1 | landed, ams |

| probe (verification) | [gpkDFy3D...pr3wDhrC](https://solscan.io/tx/gpkDFy3DMmAAuq3MQGr6ouSTyKbQXzZYK6H72DLcc9QtYEB6bF9QeF1g5y4kdaJm2FogQi1J1CAcjJmpr3wDhrC) | 100,010 | 2 | landed, ams |
| probe (verification) | [3TXXfiCm...J7p4Ycy5](https://solscan.io/tx/3TXXfiCmGiLe7wF2uCDWmEt8rGWgxEzakcAPLF4MtXEwkAc46QvK92uXHCKeuNCo25t4Tq8E1fccBmKxJ7p4Ycy5) | 100,001 | 4 | landed, ams |
| probe (verification) | [5Ti9Ct81...L7eXGxHZ8](https://solscan.io/tx/5Ti9Ct81bGgar2atSrPQJXtanMcywRjEroLxnTddDvNFa1kcd67a1e6kjDq8namgcrWVsPJjkotLZ3HL7eXGxHZ8) | 192,079 | 5 | landed, ams |

Three earlier probes (EqKpkPk8..., 44nHNaWu..., jJLJr9b2...) were sent while the gRPC stream was lagging on a long-haul link before the HTTP/2 window fix; they count toward spend but are excluded from calibration. Lag measured during development: no lead detected over 888 slots (best r = 0.053 at k = 8).

## Architecture

```
                 Solami
   +---------------------------------------------+
   | gRPC   Mirage   Blur WS   Webhooks WS   RPC/API |
   +---+------+--------+----------+---------+----+
       |      |        |          |         |
       v      v        v          v         v
   bounded  race     heat      live       Beam send, tip addresses,
    queue  stats   per slot   audits      landing records, leaders,
       |                                   history, getBlock, price
       v
   tips (per-slot stats, lag, forecast) --- quote (landing model) --- probes
       |                                        |
       +------ lifecycle (stages, failure classes, receipts) ------+
       |
   Postgres (slot_stats, receipts, audits, leader_skips)
       |
   node:http API + SSE  --->  Next.js dashboard (/ and /audit), SDK
```

## Deploy

The backend needs long-lived gRPC and WebSocket connections, so it runs as a web service, not as serverless functions.

**Postgres on Supabase (free).** Create a project in Frankfurt and copy the Session pooler connection string (IPv4; the direct connection is IPv6 only). Append `?sslmode=require`. Photon migrates the schema at startup and prunes itself to 3 days of slot rows and 200 audits, staying well under the 500 MB free limit.

**API on Render (free, Frankfurt).** `render.yaml` defines the service. In Render, create a Blueprint from the repository, then fill the environment variables (all `sync: false`): `SOLAMI_API_KEY`, `SOLAMI_REGION` (`fra`), `DATABASE_URL`, and optionally `PROBE_SECRET`, `PROBE_BUDGET_SOL`, `PROBE_INTERVAL_SEC`, `PROBE_LIMIT`, `TIP_CEILING_LAMPORTS`, `AUDIT_MAX_BLOCKS`, `WEBHOOK_PUBLIC_URL`.

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/health`

Render's free plan sleeps a service after 15 minutes without inbound requests, which also stops the streams. Keep it awake during judging with an uptime pinger hitting `/health` every 5 minutes. The free plan also has only 0.1 CPU, about half of what the stream workload needs; see Limitations. The start command caps the V8 heap at 256 MB so the process fits a 512 MB instance.

**Dashboard on Vercel (free).** Import the repository, set the root directory to `web`, and set `NEXT_PUBLIC_API_BASE` to the Render URL. Both pages are static; CORS is open on the API.

## Limitations

- **Calibrated** means every bucket a tip at or below `TIP_CEILING_LAMPORTS` can reach has 10 probes. Reachability is decided from the live distribution: with the 1,000,000 lamport ceiling the p90 to 100 bucket of tips above the Beam floor is above the ceiling, and p75 to 90 often is too (in busy hours). Buckets above the ceiling are reported as "above tip ceiling", never quoted, never probed, and do not count toward calibration, so the calibrated state can change as the market moves.
- Beam usually lands in 3 to 6 slots at these tips, so for a 2 slot deadline the model will mostly learn that it cannot promise high confidence.
- Overpay is an estimate against the slot median; Photon cannot know whether a smaller tip would have landed.
- Beam tips are a small share of landed tips (one in several hundred slots), so quotes almost always use the combined distribution above the floor.
- Heat counts swaps of $100 or more, and in the measured windows heat did not reliably lead tips; the forecast only uses heat when the lag test qualifies.
- Skipped leader slots are inferred from gaps between finalized slots; none were observed in thousands of consecutive slots during development.
- The gRPC stream carries full tip transactions (about 1.7 MB/s); Yellowstone has no field projection for transactions, so it cannot be trimmed further without losing tips.
- The API needs about 0.2 of a CPU core for the stream workload, twice what Render's free plan provides (0.1 CPU). On the free plan expect the gRPC queue to grow and slots behind to rise (both shown in `/health` and on the dashboard). Render Starter (0.5 CPU) or any small VM with a full core is enough; the code is the same.
- `POST /send` accepts legacy and version 0 transactions (the web3.js parser); version 1 transactions are read everywhere else.

## License

MIT
