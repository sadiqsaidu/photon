# Tipwise

**The going rate to get into the next Solana block.** Tipwise watches every tip that lands in every block, live, tells you what to pay, sends your transaction through Solami Beam, and hands you a receipt that proves when it landed.

- **Live site:** https://tipwise.tech
- **API:** https://api.tipwise.tech
- **Demo video:** DEMO_VIDEO_URL

![The Tipwise live board: Saver, Standard and Express fares on a split-flap board, with every landed tip drifting past below](docs/screenshots/home.png)

## In 30 seconds

Solana makes a new block every 0.4 seconds. When it is busy, more transactions want in than fit, so you add a tip to get in fast. Nobody posts the price: pay too much and you waste money on every trade, pay too little and your trade lands late or misses.

Tipwise reads every tip that gets a transaction into every block, straight from a Solami Yellowstone gRPC stream, and turns that into three fares: Saver, Standard and Express, each with an honest chance of landing in time. It can send your transaction for you through Solami Beam and hand you a receipt that says when it landed, or in plain English why it did not. And it pays for its own small test transactions to check that its promises hold, so you can see it is honest.

## Who it is for

- **The bot developer** hardcodes a 0.002 SOL tip. In quiet hours that is far above the going rate, paid on every trade. During big launches it falls below the cheapest quarter of tips and loses the race. They replace the constant with the live fare and `send()`, and every transaction comes back with a receipt.
- **The active trader** uses a trading tool with a "turbo" tip preset they never think about. They paste their wallet into Tipwise and see what it cost them, trade by trade, against the going rate in the same blocks.
- **The keeper or liquidation bot** has to land within a couple of blocks during a crash. Tipwise tells them honestly how likely that is at their tip ceiling, instead of promising what the network cannot deliver.
- **Anyone whose transaction "just failed"** gets a receipt that says in plain English what happened (the blockhash expired, the block builder skipped its turn, Beam refused it, or the program failed on chain) and what to do next.

## What you can do

**See the live fare.** The home page is a departure board for block space: what to tip right now for Saver, Standard and Express, in dollars and SOL, how fast each lands and how often. Below it, every tip of the last 4 minutes drifts past with the going rate as a band.

**Check a wallet.** Paste any wallet, or pick one of the bots that tipped most in the last 10 minutes. Tipwise reads its last 100 transactions and prints a receipt: tips paid, the going rate in the same blocks, what was paid above it, how many tips were too low to compete, and a stamp (OVERPAID, FAIR or TOO LOW). "Watch this wallet live" prints new trades onto the receipt as they land.

![A wallet checkup receipt stamped OVERPAID: a live bot that paid $2.24 in tips, $2.21 of it above the going rate](docs/screenshots/check.png)

**Send a test.** Pick a fare and press "Send a test for me": Tipwise sends a real mainnet transaction through Beam from its own wallet, and you watch it travel from sent to finalized. Or send from your own wallet (Phantom, Solflare, Backpack) for the price of the tip. Either way you get a ticket with the promise check and a plain explanation.

![A Tipwise ticket stamped LANDED, with the journey from sent to finalized](docs/screenshots/send.png)

**See the track record.** Promise versus reality: for each price range, what Tipwise would have promised before each test trip and how often it actually landed in time.

![Promise versus reality on the track record page](docs/screenshots/track-record.png)

**Build with it.** The developer page has the SDK, curl, a live console and the API reference. Under the hood shows the eight Solami products at work, live.

![The eight Solami products, live, on the Under the hood page](docs/screenshots/under-the-hood.png)

## How Solami is used

| Product | What Tipwise does with it |
| --- | --- |
| Yellowstone gRPC | One subscription: slots (processed, confirmed, finalized), block meta (blockhash and block height), every successful transaction touching any of the 8 Jito tip accounts or the 15 Beam tip addresses (the landed tip distribution per slot, and lifecycle tracking for Tipwise's own sends), and status-only updates for failed transactions touching Beam tip addresses (`failed_onchain`). Reconnects resume with `from_slot`. Updates pass through a bounded queue so a slow moment never backs up Solami's server-side buffer. |
| Mirage | The same slot stream over a plain WebSocket (a saved Mirage subscription, `tipwise-slots`), raced against gRPC: wins per source and the median lead. |
| Blur (WebSocket) | Decoded market events: swaps of $100 or more, token creations, pool creations, graduations and surges, weighted into a per-slot heat signal. |
| Beam | Every test trip, every free test send and every wallet or SDK send goes out as `sendTransaction` on Solami RPC with a transfer to a Beam tip address, which routes it through Beam. Tip addresses come from `GET /onchain/tip-addresses`; each receipt carries the landing record from `GET /swqos/tx/{signature}` (region, whether it went through Jito). |
| RPC | `getSlotLeaders` (next block builders), `getRecentPrioritizationFees` (priority fee in every fare), `getLatestBlockhash` (fallback for `/blockhash`), `getSignatureStatuses` (expiry double check and restart recovery), `getBlock` (checkup benchmarks for blocks Tipwise did not stream), `getTransaction`, `getBalance`. |
| Data API | `getTransactionsForAddress` (Solami's paginated wallet history RPC method) for wallet checkups, falling back to `getSignaturesForAddress` plus `getTransaction`; `GET /data/token/price` every 60 s for the SOL price behind every dollar figure. |
| Webhooks | One stream-mode webhook (`tipwise-audit`, enriched transfer events) for every wallet being watched live, consumed over `wss://{region}.ws.solami.dev/webhooks/stream/{id}`. Watches expire after 15 minutes; the last one deletes the webhook. HTTP delivery with HMAC verification is supported when a public URL is configured. |
| Leader tracking | `GET /leader-tracking/current` every 2 s: the chain tip, so the site shows how many blocks the stream is behind. |

## Quick start

Requires Node 20.12 or newer and Docker (or any Postgres 14+).

```bash
git clone https://github.com/sadiqsaidu/tipwise.git
cd tipwise
npm install
cp .env.example .env          # add SOLAMI_API_KEY, optionally PROBE_SECRET
docker compose up -d db
npm run db:migrate            # optional: the server also migrates at startup
npm run doctor                # checks every Solami product with your key
npm run serve                 # API and streams on http://localhost:8080
```

Then the site:

```bash
cd web
npm install
cp .env.example .env.local    # NEXT_PUBLIC_API_BASE=http://localhost:8080
npm run dev                   # http://localhost:3000
```

## Getting a key

Sign up at https://solami.dev/signup?ref=st-earn-sep-26. The Pro trial covers everything Tipwise uses.

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
| `DATABASE_URL` | no | `postgres://tipwise:tipwise@localhost:5432/tipwise` | Postgres URL. `?sslmode=require` encrypts without verifying the certificate (Supabase); `verify-full` verifies. |
| `PORT` | no | `8080` | HTTP port (binds 0.0.0.0). |
| `PROBE_SECRET` | no | | Base58 secret key of a funded burner wallet. Enables probes and `npm run demo`. |
| `PROBE_INTERVAL_SEC` | no | `60` | Seconds between probes. |
| `PROBE_BUDGET_SOL` | no | `0.05` | Total SOL probes may ever spend (tracked in Postgres). Also capped by the wallet balance minus a rent reserve. |
| `PROBE_LIMIT` | no | `0` | Max probes one process sends; 0 means until calibrated or out of budget. |
| `TIP_CEILING_LAMPORTS` | no | `1000000` | Highest tip Tipwise will quote or probe. |
| `AUDIT_MAX_BLOCKS` | no | `40` | Max `getBlock` calls per audit for slots without stored stats. |
| `WEBHOOK_PUBLIC_URL` | no | | Public base URL of this server. When set, webhooks also POST to `/webhooks/solami` (HMAC verified). |
| `ADMIN_TOKEN` | no | | Bearer token for `GET /admin/probe` (probe budget, spend, wallet). Unset: that route answers 404. |
| `DEMO_DAILY_MAX` | no | `40` | Server-paid test sends ("Send a test for me") per UTC day. They share the probe budget. |
| `ALLOWED_ORIGINS` | no | `*` | Comma separated origins allowed by CORS. |
| `API_DOMAIN` | prod | | Hostname Caddy serves and gets a certificate for (`docker-compose.prod.yml`). |
| `POSTGRES_PASSWORD` | no | `tipwise` | Password of the production Postgres container. |
| `NEXT_PUBLIC_API_BASE` | web | `http://localhost:8080` | Backend URL for the site (`web/.env.local`). The only web variable. |

## Run modes

| Command | What it does |
| --- | --- |
| `npm run serve` | Streams, probes, API and SSE (TypeScript via tsx). |
| `npm run build && npm start` | The same server compiled to `dist/` (production). |
| `npm run doctor` | Calls every Solami product with your key and prints reachable or unreachable with the exact error. |
| `npm run demo` | Uses `PROBE_SECRET` to build a self transfer with a memo, quotes deadline 2 at confidence 0.9, sends through a running server (`TIPWISE_URL`, default `http://localhost:8080`), waits for the receipt and prints it with a Solscan link. |
| `npm test` | Unit tests: quote and landing model, forecast and lag, audit math, failure classes, fares, mood, receipt explanations, track record, example wallets, the rate limiter. |
| `npm run typecheck` | TypeScript strict check. |

## SDK

`src/sdk.ts` depends only on `@solana/web3.js` and runs in Node or the browser. Copy it into your bot.

```ts
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createTipwise } from "./sdk.js";

const tipwise = createTipwise("https://your-tipwise-host");
const fare = (await tipwise.fares()).find((f) => f.id === "standard")!;

const message = new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fare.priorityFeeMicroLamports }),
    ...yourInstructions,
    await tipwise.tipInstruction(wallet.publicKey, fare.tipLamports),
  ],
}).compileToV0Message();
const tx = new VersionedTransaction(message);
tx.sign([wallet]);

const signature = await tipwise.send(tx, "standard");
const receipt = await tipwise.waitForReceipt(signature);
console.log(receipt.explanation?.title, receipt.explanation?.whatToDo);
```

`tipwise.quote({ deadlineSlots, confidence })` prices any other deadline and confidence.

## API

| Method and path | Returns |
| --- | --- |
| `GET /health` | Stream health (connected, bytes, reconnects, backpressure closures, queue depth), slots behind and the maximum, degraded features. In memory, cheap. |
| `GET /events` | Server-sent events: `slot`, `tips`, `heat`, `lag`, `quote`, `fares` (at most every 2 s, on change), `products` (every 5 s), `probe`, `lifecycle` (with `explanation`), `stream`, `audit`. Heartbeat every 15 s. |
| `GET /stats` | Snapshot for the first paint: 600 slot window, mood, fares, SOL price, Solami products, calibration, track record, recent receipts. |
| `GET /fares` | Saver, Standard and Express: `{ id, label, deadlineSlots, deadlineMs, confidence, tipLamports, tipSol, tipUsd, priorityFeeMicroLamports, probability, meetsConfidence }`, plus `calibrated`, `progress`, `samples`, `solPriceUsd`, `mood`, `updatedAt`. |
| `GET /track-record` | Promise versus reality per price range at the Standard deadline (each test trip scored against the model built from earlier trips), and the latest test trips. |
| `GET /audit/examples` | The 3 wallets that tipped most often in the last 10 minutes (live from gRPC). |
| `GET /blockhash` | `{ blockhash, lastValidBlockHeight }` from the confirmed stream, so a browser needs no RPC key. |
| `POST /demo/send` | Body `{ "fare" }`. Tipwise sends one tipped transaction from its own wallet. Limits: one every 20 s globally, one per IP every 3 minutes, `DEMO_DAILY_MAX` per day, the probe budget. Over a limit: 429 `{ error, retryAfterSec, reason }`. |
| `GET /admin/probe` | Probe budget state. Only with `authorization: Bearer <ADMIN_TOKEN>`; otherwise 404. |
| `GET /quote?deadline=2&confidence=0.9` | Tip, priority fee, probability, `meetsConfidence`, `calibrated`, per-bucket status. |
| `GET /tips/addresses` | Beam tip addresses and Jito tip accounts. |
| `POST /send` | Body `{ "tx": "<base64 signed transaction>", "fare"? }`. Returns `{ "signature" }`. The transaction must carry at least 100,000 lamports to a Beam tip address. With a fare, the receipt records the promise. |
| `GET /receipt/:signature` | Stages with slot and ms, landed slot, failure class, Beam landing record, `settled`, `kind`, `fare`, `quotedProbability`, `deadlineSlots`, `sentAt`, and a plain English `explanation`. |
| `GET /calibration` | Per bucket predicted vs actual, model probability, status, Brier score. |
| `GET /leaders` | Next 20 slots of leaders with slots seen, median tip, probes landed, skipped slots. |
| `POST /audit` | Body `{ "address", "limit" }` (limit 1 to 300, default 100). Runs and stores an audit; the same address within 60 s returns the stored one. 6 per minute per IP. |
| `GET /audit/:address` | The stored audit. |
| `POST /audit/:address/watch` | Adds the wallet to the live webhook stream for 15 minutes. 3 per minute per IP. |
| `POST /webhooks/solami` | HTTP webhook delivery (only when `WEBHOOK_PUBLIC_URL` is set). |

The Solami key never leaves the server.

## Methodology

**Tips.** For every successful transaction that touches a tip account, the tip is the post balance minus the pre balance of that account (lookup-table loaded accounts included). Tips are grouped by slot; when gRPC reports the slot confirmed, Tipwise computes count, p25, p50, p75, p90 and max, keeps the last 600 slots in memory, and writes one row per finalized slot to Postgres (batched every 2 s). Tips are tagged `jito` or `beam`.

**The Beam floor.** Beam rejects tips below 100,000 lamports, which sits around the 90th percentile of all landed tips. Quotes therefore price inside the tips a Beam send could actually pay: landed tips at or above the floor (from Beam tips alone once there are 200 in the window). The API and the river on the home page show where the floor sits in the full distribution.

**Heat and the lag test.** Each Blur event adds to its slot's heat (swap 1, token creation 3, pool creation 5, surge 5, graduation 10); events without a slot use the latest processed slot. Heat counts swaps of $100 or more, which cuts Blur bandwidth by about 85%. Every 30 s Tipwise computes the Pearson correlation between heat at slot t and tip p75 at slot t+k for k from 0 to 20 over the last 900 slots, and publishes the best k and r. The forecast uses heat only when r is at least 0.2 and k at least 1. Under the hood shows the result either way, including "no lead detected".

**Forecast.** Holt double exponential smoothing on per-slot p50 and p90, projected h slots ahead. When the heat signal qualifies, the projection is multiplied by `1 + beta * z(heat now)`, with beta fitted by least squares on the window and the multiplier clamped to [0.8, 2.0].

**Landing model and quote.** Every probe records its tip, the tip's percentile in the distribution at send time, the predicted probability, and the slots from send to land. Probes fall into five percentile buckets of the tips Beam accepts (0 to 25, 25 to 50, 50 to 75, 75 to 90, 90 to 100). For a deadline D, each bucket with at least 10 probes gets the Laplace-smoothed rate (landed within D + 1) / (n + 2). These rates are made non-decreasing across buckets by a weighted isotonic fit (pool adjacent violators, weights n + 2): Tipwise assumes a bigger tip does not lower the chance, and where the data contradicts that, the two buckets are averaged rather than the cheaper bucket's result being copied upward. A bucket with fewer probes inherits the estimate of the nearest measured bucket below it (`basis: "inherited"`); before any bucket has 10 probes, or for a thin bucket with no measured bucket below it, the prior (0.5, 0.65, 0.8, 0.9, 0.95) is used (`basis: "prior"`, never above a measured bucket above it). `calibrated` means every reachable bucket has 10 probes. A bucket is reachable when some tip at or below `TIP_CEILING_LAMPORTS` falls inside it; buckets above the ceiling are reported as "above tip ceiling" and never quoted or probed. The quote is the cheapest reachable bucket whose estimate meets the requested confidence, priced at that bucket's upper percentile forecast h slots ahead (h is the deadline for `GET /quote` and `FARE_FORECAST_SLOTS`, currently 0, for fares), floored at the Beam minimum and capped at the ceiling. If the ceiling clamps the tip into a cheaper bucket, the estimate is taken for that cheaper bucket. If no bucket qualifies, the cheapest reachable bucket with the highest estimate is returned with `meetsConfidence: false`, and `ceilingLimited: true` when buckets above the ceiling were not evaluated. Each quote reports its bucket and `estimate` (`basis`, `samples`, `landed`, `newestSlot`). The priority fee is p75 of `getRecentPrioritizationFees`, cached 10 s, and is the same for every fare.

**Probes.** With `PROBE_SECRET` set, Tipwise sends one probe every `PROBE_INTERVAL_SEC`: a compute unit price, a `tipwise-probe` memo and a tip to a random Beam tip address. Each probe targets the least-sampled reachable bucket (ties at random) with the tip whose mid-rank falls inside that bucket, closest to its middle. Many tips are exactly 100,000 lamports, so a plain midpoint can land in the neighbouring bucket; the mid-rank search avoids that. Before the first send Tipwise simulates the whole run (every probe until each reachable bucket has 10, or `PROBE_LIMIT`) and does not start if its cost exceeds the budget left. Probing stops when the reachable buckets are full or the budget is spent; spend is stored in Postgres, so a restart cannot overspend.

**Fares.** Saver (10 slots at 0.8), Standard (4 slots at 0.9) and Express (1 slot at 0.9) are targets: a deadline and a confidence (`FARES` in `src/config.ts`). They are not separate lanes: every fare is sent through Beam with the same priority fee, so two fares with the same tip are the same transaction and the label only changes what the receipt checks. No fare asks for more than 0.9, since with 10 probes per bucket the smoothed estimate tops out at 11/12 (about 92%, an estimate from ten observations, not a measured long-run rate). Fares price the live window without the per-slot trend projection (per-slot percentiles swing by 10x between slots, so any projection made the board jump). Each fare is quoted on its own and describes its final tip; nothing lowers a tip after quoting. Because landing within a longer deadline includes landing within a shorter one, a slower fare that meets its target never needs a pricier bucket than a faster fare that meets its own; a faster fare that misses its target can be cheaper, and is labelled as below target. Equal tips are expected when the cheapest bucket already meets the targets, or when no pricier bucket shows a better estimate; the board says so without inferring anything about the market. Times in seconds are the deadline at an assumed 0.4 s per slot, not measured arrival times.

**Mood.** The median landed tip of the last 50 confirmed slots against the median of the whole window: below 0.8 times is quiet, above 1.5 times is rush hour, otherwise busy.

**Track record.** Each test trip is scored out of sample against the Standard deadline: the estimate is what the landing model would have said from the trips sent before it (priors until calibrated), and the outcome is whether it landed within that same deadline. The page reports the average gap in percentage points and its direction; estimates that run low and estimates that run high are both calibration errors. Probes stop once every reachable bucket has 10, so estimates can age while the market changes; each quote reports `newestSlot` for its bucket. Re-sampling or weighting recent probes would need ongoing probe spending and is left as a follow-up.

**Free test sends.** `POST /demo/send` sends one transaction from the probe wallet at a fare's tip and priority fee, tracked like any send with `kind: "demo"`. Demos share the probe budget but stay out of calibration: their tips follow the fare rather than a target bucket, and their promise is for the fare's deadline, not the 2 slot calibration deadline.

**Failure classes.** `send_rejected`: Beam returned an error at send time. `failed_onchain`: the transaction landed with an error. `leader_skipped`: not landed before expiry, and one of the first 4 slots after the send never confirmed while a later slot did. `expired_blockhash`: not landed and the streamed block height passed the blockhash's last valid block height (never decided on wall clock). Before either of the last two, Tipwise makes one `getSignatureStatuses` check in case the stream missed the landing. After settling, the Beam landing record is attached to the receipt.

**Receipt explanations.** `explain()` in `src/explain.ts` is a template over the facts on the receipt, one per outcome (landed, with the promise check, or one of the four failure classes). No language model is involved: it is instant, free, deterministic and cannot invent a cause.

**Audit math.** For each transaction: tip paid is the sum of System transfers from the wallet to any Jito or Beam tip address (cross-program transfers included), priority fee is the fee minus 5,000 lamports per signature. The slot benchmark comes from stored slot stats, or from `getBlock` for slots Tipwise did not stream (concurrency 8, at most `AUDIT_MAX_BLOCKS` per audit). Overpay is `max(0, tip - slot p50)`; a transaction is underpaid when its tip is below the slot's p25. **Overpay is an estimate against the slot median**, not a claim that a smaller tip would have landed. The stamp is OVERPAID when more than 30% of the tips paid were above the going rate, TOO LOW when more than 25% of compared trades were too low, otherwise FAIR. The monthly figure projects the overpay over the time span the checkup covers.

## Costs

**Probes.** A probe costs its tip plus a 5,020 lamport fee. At the default 60 s interval and tips between the Beam floor (100,000) and a 1,000,000 lamport ceiling, that is between 0.0063 and 0.06 SOL per hour. Probing is capped by `PROBE_BUDGET_SOL` and stops by itself once every reachable bucket has 10 probes. Filling the three reachable buckets from scratch costs roughly 0.004 to 0.01 SOL at the distribution measured in October 2026.

**Streams.** Measured over a 10 minute mainnet run (October 2026, ams region): gRPC 1.67 MB/s (full successful tip transactions; included in the Pro plan's gRPC streams), Blur 0.09 MB/s for swaps of $100+ plus 0.001 MB/s for launch-type events (Solami bills Blur at $0.20 per GB: about $1.60 to $1.90 per day), Mirage 0.001 MB/s, webhook stream about 0.01 to 0.03 MB/s per busy watched wallet.

**Server.** The API process used about 21% of one CPU core and about 280 MB of memory (V8 heap capped at 256 MB) with all streams up and no watched wallets.

## Mainnet proof

Production run of the hosted instance (Solami region ams), October 11, 2026.

| What | Value |
| --- | --- |
| Hosted site | https://tipwise.tech |
| Hosted API | https://api.tipwise.tech (try `/health`, `/fares`, `/calibration`) |
| Test trips | 40 sent, 40 landed through Beam, 39 within 2 blocks and one in 3 (last 30: 15 in 1 block, 14 in 2, 1 in 3) |
| Calibration | Complete: every reachable bucket has 10 probes. Brier score 0.126 against a 2 block deadline (the starting estimates were cautious: 39 of 40 trips landed within 2 blocks). |
| Fares at the time of writing | Saver 10 blocks: 125,000 lamports, 92%; Standard 4 blocks: 125,000 lamports, 92%; Express 1 block: 125,000 lamports, 67% (best effort). At 1 block the pricier buckets did not land faster (tips of 500,000 lamports and up landed in 1 block less often than tips near the Beam floor), so Express quotes the cheapest tip with its real chance. |
| Lag result | No lead: best correlation r = 0.067 at k = 3 blocks over 887 blocks, below the 0.2 threshold, so the forecast does not use heat. |
| Solami products | All eight live at the time of writing (Yellowstone gRPC, Mirage, Blur, Beam, RPC, Data API, Webhooks, Leader tracking). |

Calibration per bucket:

| Bucket (tips Beam accepts) | Probes | Predicted at send | Landed within 2 blocks | Model now | Status |
| --- | --- | --- | --- | --- | --- |
| p0 to p25 | 10 | 0.5 | 1 | 0.917 | reachable |
| p25 to p50 | 10 | 0.65 | 1 | 0.917 | reachable |
| p50 to p75 | 10 | 0.8 | 1 | 0.917 | reachable |
| p75 to p90 | 10 | 0.9 | 0.9 | 0.917 | reachable |
| p90 to p100 | 0 |  |  | 0.917 | above tip ceiling |

Production sends (all through Beam via Solami RPC):

| Kind | Signature | Tip (lamports) | Blocks to land | Beam record |
| --- | --- | --- | --- | --- |
| free test send (Standard) | [om7YZR33...dttzjQ](https://solscan.io/tx/om7YZR339PZQghJMBKHU8MqERfHKkeWZmqj7Gmp4mDRjeNH26TJLabqCWinnBFb6CaXbs78PnFFLnNSbgdttzjQ) | 108,955 | 1 | landed, ams |
| free test send (Express) | [4NVyB4cK...6VnCXE](https://solscan.io/tx/4NVyB4cK2iacFwkQcVLqouvTykWfNq9TyF6xG59K9h6i7pLXWn1P8ZvqmRWMp7bxk9bibBBS6UYLrwXjnn6VnCXE) | 1,000,000 | 1 | landed, ams |
| free test send (Standard) | [5EHzvLSo...SG2U4R](https://solscan.io/tx/5EHzvLSo8dk6wwm5WW2FpqpRytJgdY4JF5KVkHY178ArMMKPFfJVfkFVHcsWQcAR8nNGqJgK3keAN9VPQJSG2U4R) | 108,726 | 1 | landed, ams |
| free test send (Standard) | [2z52gGMM...WouMey](https://solscan.io/tx/2z52gGMM9HsuCB7xgeA857o6SD4VzdDY9aUFfvvUwqxh4tUjeYcmnNwizW86vbe4oYKCzyF1FzZ3BMgWVbWouMey) | 109,000 | 2 | landed, ams |
| test trip | [4zNQHaFA...2Bshab](https://solscan.io/tx/4zNQHaFAXcVGfo9esnaKoaiEEBaaZJcH2FuqoiQfteCTCQsJKkTLLUFMZXbRReWrjNjuhJ3QKYEa2Xawpa2Bshab) | 200,001 | 1 | landed, ams |
| test trip | [2ketwm4z...nASMqy](https://solscan.io/tx/2ketwm4zCLg9acFUyFfA8gEaEm4wdhA1zHfkjo6samrHUw74ySwdp6epbJahUFBr5gGbttNm4auuwRHbn5nASMqy) | 954,000 | 2 | landed, ams |
| test trip | [2b2QFpvT...AJaKXY](https://solscan.io/tx/2b2QFpvTMLH9jgZKoG7A2j8UpBCFxhricQP4fSNam24Y9YdSF2WTds4FbxUnm8xEUC3RAT8KYC5CoDQj8WAJaKXY) | 100,000 | 1 | landed, ams |
| test trip | [3Hos92CW...eNSKYV](https://solscan.io/tx/3Hos92CWmjQjWHoXTAGti5vVAguT3qBSqWNw5z156m6ZmTNd6K4gvmr7aL6YeDQXPchi26dnsjiMXwWuhdeNSKYV) | 500,001 | 2 | landed, ams |
| test trip | [4vfv5Sh1...TyLB3z](https://solscan.io/tx/4vfv5Sh1ouQoPSKNNL3j4GDY9VArFjn3o1Zm66qdTkAnNmZSbXvoRfG4jonjAMtv3FaAajyPwnu27RxybNTyLB3z) | 171,580 | 1 | landed, ams |
| test trip | [3G4NCrga...wAhieS](https://solscan.io/tx/3G4NCrga14YaCrKJ7QWf77ZKuJj6iqDA8m9rnP97bZKnqFuMUTqkvmjCGdt9mEwtbfWvPfe9gZuYsEsf9awAhieS) | 995,001 | 2 | landed, ams |
| test trip | [2j9UqDrY...tN9fsh](https://solscan.io/tx/2j9UqDrYinvFh4y2aRTHD8RUEL54Fs3WSHJqRVdnadRf7fQXtNALEsRpQ6PSD4UM1zSAD7vCUBqQ3nUAGEtN9fsh) | 200,001 | 2 | landed, ams |
| test trip | [4isSmrFJ...YxefiE](https://solscan.io/tx/4isSmrFJzHpk2466zJrUZcniNecEqTKG6NWMYCwssPwqSpfD8geUHRHeR6Yi2KwukqtsH5DzZ5zi4m4XXxYxefiE) | 100,001 | 1 | landed, ams |
| test trip | [4ccd64Mk...fosx2d](https://solscan.io/tx/4ccd64MkZB6W8JimiEF2EPXt81pLDJkEestX3DfaqhNpgNbpA562Tvi4wXzkC91cbTumtUmdpjWKiSXxjTfosx2d) | 100,000 | 1 | landed, ams |
| test trip | [3ym9eWP3...f17NBU](https://solscan.io/tx/3ym9eWP3PBYYHdvANZTUHMjoKs5RZTLsQWchMuLiu9JzK7EasxoSjeBF8oneEi8DbyyHGQTkXq9wKXbbYXf17NBU) | 709,100 | 1 | landed, ams |
| test trip | [UafUER8k...Dwx3v8](https://solscan.io/tx/UafUER8k7SWsYcBvTm6khBegETpJkYDt5JNeR2KshyB4wkdSicbu5Kfri1LBhYFUGrN36NmXGiP8TZviCDwx3v8) | 200,000 | 1 | landed, ams |
| test trip | [52FPS3NS...SPQpTs](https://solscan.io/tx/52FPS3NSVgvr8MFcxFESkz8mnniYH4xXq8t1wiQPdZnTYAcJdP7CY2Ke9NhgvC28tqeKcscj62QW6feQnnSPQpTs) | 100,000 | 1 | landed, ams |
| test trip | [4UQoJGTf...RqwrVR](https://solscan.io/tx/4UQoJGTfBhVabHoULQCxuMcaptdCtrCEeHUvgecnFHWbGfiSuUxxtq1ydxP2mt1gJjTnGy2gEeWStE7X8URqwrVR) | 931,218 | 1 | landed, ams |
| test trip | [4L3Mf6Jy...bmzkpj](https://solscan.io/tx/4L3Mf6JyYFSsespRKTEoh29TiTdfsWjmU8KEHMGYsPKtuH7ifEBnExrBFPcuv2BxBCw3gHVH2uoNyE1zEpbmzkpj) | 156,751 | 1 | landed, ams |
| test trip | [5nQTZdZd...XYexSc](https://solscan.io/tx/5nQTZdZdqvvmSmE9JBuyMwgfdiqw5jqqDQ9mzHaonAr5C7i4Pxycm123MNgrrpL57quwaKa8eTbz6Kjj71XYexSc) | 128,711 | 2 | landed, ams |
| test trip | [2voNUtgA...fVjubu](https://solscan.io/tx/2voNUtgADeEvfvxiESnjvScGzmEt7k7SqpTPVqvEAsuBGyP9y43UdeaMhYfCn1uE5nZpmbUhSCR4jfKQqkfVjubu) | 1,000,000 | 1 | landed, ams |
| test trip | [2L9vA95u...vg3dHr](https://solscan.io/tx/2L9vA95uk94rjejdoArEkQAGXpChMoVbGs6TGejwaNTh2Mo5KUAyMMMHzmQ8xLn6Z8xuFNmEKhMpviFcrUvg3dHr) | 500,001 | 2 | landed, ams |
| test trip | [yjudW5u5...4V1JQ7](https://solscan.io/tx/yjudW5u5aHJZAUpGg8FxaRXbq5nmp1y349kiyHgighhNQwhHU1JQzDK5ZCDKd2aeACZerdjdXpeaBBhvr4V1JQ7) | 100,001 | 1 | landed, ams |
| test trip | [2xi3eoZV...9nmSxV](https://solscan.io/tx/2xi3eoZVstkAcRB2G4nmTMporyyufRbC2TEeAQt2Bb74ESp841Xe1Yb5RcfVdmfuVY4ThKpUjnMjcpVmoE9nmSxV) | 905,001 | 2 | landed, ams |
| test trip | [5gSE7ysD...Scg3mg](https://solscan.io/tx/5gSE7ysD2wPozMfUBnHWiASqGEu8b6k6EgsbpWsy7AtwtfYHxfrJ2unn9sa1RtdsrUMu9UcN661Sv2UMypScg3mg) | 202,425 | 2 | landed, ams |
| test trip | [ywbZrNTo...WtkAYt](https://solscan.io/tx/ywbZrNTo5svrajwM2iEcP3ARnXBr55he88Ap1UxLwZvVPyBzXsYF51igJTZN2TxmYdHTW6eCPVq5ZXKSVWtkAYt) | 101,980 | 2 | landed, ams |
| test trip | [331rdwWH...p3voj9](https://solscan.io/tx/331rdwWHaxLKkAcMCRgDc5RVvv6UkvmFdjebsEcHsn69ShjQnM4fYWwGwLuoHXbFSTm7zpmPvR2WZn9JVSp3voj9) | 1,000,000 | 3 | landed, ams |
| test trip | [218KM7ru...Fk7QsX](https://solscan.io/tx/218KM7ruwaD2Bc2WhxHnXASe9CLYJwi4wS5RgE6oR8PvYkJhefnYu6sWWbrxL8tXUrBi2ssZCGaRBWwmNFFk7QsX) | 1,000,000 | 1 | landed, ams |
| test trip | [5evG1uos...aYN7h8](https://solscan.io/tx/5evG1uosyENxsXHZLkLnNCLt8dGZrBWhJAR7fKug4tM61D4s4wykRbzT5gACrKiJKeWykkfjbZ21qb7EZEaYN7h8) | 1,000,000 | 2 | landed, ams |
| test trip | [3Z5U1nPy...mRwxMT](https://solscan.io/tx/3Z5U1nPyd1LG6rjotsNbRfRtP4XUG3KZTLkyHQxkH7HAEtbzhDB8NpeccfkeHLffLHwjXQ8D84rVhY5iRzmRwxMT) | 1,000,000 | 2 | landed, ams |
| test trip | [4Cy9hpkr...FpZYJY](https://solscan.io/tx/4Cy9hpkrLJ7KWypDdDnYe8TkkJQmeiaQcTMCWsDWGBH633vxEF3ZbnMwaadNqYWHionAnpxttQf6rbEFhyFpZYJY) | 1,000,000 | 2 | landed, ams |
| test trip | [YzfVxFzo...ZJCzgf](https://solscan.io/tx/YzfVxFzo7Ut95q1pbczKeDRmLaRm2SY9rcHw58ZbkSbAkMv6vD9jsfqR7mkZZXA8PCEvdUvJiFrcLNeZaZJCzgf) | 1,000,000 | 2 | landed, ams |
| test trip | [5Gp9xSiq...Qe3mr4](https://solscan.io/tx/5Gp9xSiqJRhhXPUxVwmkKYQQn5nJZyBCAgUkHXPMkPvGKXH2oKburnA9citSthQqjvH6WYzcmbL9pjvSEnQe3mr4) | 1,000,000 | 2 | landed, ams |
| test trip | [GLDUhsD3...zqMimJ](https://solscan.io/tx/GLDUhsD3919t9PJmmWx2r8eH8oTuUbziWFfsMp2nAeGoDmimMiA2na7weogH64PQArteDNS4HZPfBLGFTzqMimJ) | 1,000,000 | 1 | landed, ams |
| test trip | [5iGreonE...ubMnZt](https://solscan.io/tx/5iGreonEADD1vvmQw6bccD9vtiDVHJVQ9CsPAy7JN98fX3z4xku1DXqvciHwLnTSNfvoTG9KmmLZMdG9HsubMnZt) | 1,000,000 | 1 | landed, ams |

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

| free test send (Saver) | [21R9Jsrv...Gb4gdj](https://solscan.io/tx/21R9JsrvYdkeNxidGgQGkkTm7JwNJ15nocSF1SRriu6qTFvMpq8o5u26SY1C5RTFEV2HnmJ6JMDjsegmBvGb4gdj) | 1,000,000 | 2 | landed, ams |
| free test send (Saver) | [299rq6AT...j2g3mW](https://solscan.io/tx/299rq6ATYVQD1rXRW1E6qqR3JdVsYu5Ez5UgJeKp6mn9sB6q2MchUgKqZsgSk2T5Kqnrt1oTjfwAx265jrj2g3mW) | 1,000,000 | 2 | landed, ams |

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
   node:http API + SSE  --->  Next.js site (board, checkup, send, track record), SDK
```

## Deploy

The backend holds long-lived gRPC and WebSocket connections and needs about 0.2 of a CPU core sustained, so it runs on a small VM, not on serverless functions or a free web service. The frontend is static and runs on Vercel.

**1. Create the VM (Azure for Students).**

1. In the Azure portal: Create a resource, Virtual machine.
2. Resource group: new, `tipwise`. Name: `tipwise-api`. Region: **West Europe**. Image: **Ubuntu Server 24.04 LTS**. Size: **B2s** (2 vCPU, 4 GB). Do not pick B1s: its burst baseline is below what the streams need.
3. Authentication: SSH public key, username `azureuser`, generate a new key pair and download it.
4. Inbound ports: allow **SSH (22), HTTP (80), HTTPS (443)**.
5. Disks: the default 30 GB Standard SSD is enough. Review and create.
6. Open the VM, copy its **public IP address**. Under Configuration, set the IP to static if it is not already.

**2. Point a domain at it.** In your domain's DNS add an `A` record for `api` pointing at the VM IP (for example `api.tipwise.tech`). If the domain is not ready yet, use `<ip-with-dashes>.sslip.io` (for example `20-1-2-3.sslip.io`): it resolves to the IP with no setup, and Caddy can still get a certificate for it.

**3. Install Docker and start the stack.**

```bash
ssh -i ~/Downloads/tipwise-api_key.pem azureuser@<VM IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && exit        # log out so the group applies
ssh -i ~/Downloads/tipwise-api_key.pem azureuser@<VM IP>

git clone https://github.com/sadiqsaidu/tipwise.git
cd tipwise
cp .env.example .env
nano .env
```

In `.env` set at least:

```bash
SOLAMI_API_KEY=sk_...
SOLAMI_REGION=ams
PROBE_SECRET=<base58 secret key of a funded burner wallet>
PROBE_BUDGET_SOL=0.06
API_DOMAIN=api.tipwise.tech
ALLOWED_ORIGINS=https://tipwise.tech,https://www.tipwise.tech,http://localhost:3000
ADMIN_TOKEN=<any long random string>
POSTGRES_PASSWORD=<any long random string>
```

Remove the `DATABASE_URL` and `PORT` lines (the compose file sets both). Then:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api      # Ctrl+C to stop following
curl https://api.tipwise.tech/health
```

`docker-compose.prod.yml` runs three containers with `restart: unless-stopped`: `db` (Postgres 16 on a named volume, not exposed), `api` (this repository's `Dockerfile`, non-root, heap capped at 256 MB) and `caddy` (ports 80 and 443, automatic HTTPS for `API_DOMAIN`, reverse proxy with flushing disabled so `/events` streams). To update: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

**4. Frontend on Vercel (free).** Import the repository in Vercel, set the root directory to `web`, add the environment variable `NEXT_PUBLIC_API_BASE=https://api.tipwise.tech`, and deploy. Add your bare domain under Project, Settings, Domains and follow the DNS record Vercel shows. Put the final Vercel URL and domain in `ALLOWED_ORIGINS` on the VM and restart the API (`docker compose -f docker-compose.prod.yml up -d`).

**Probe wallet.** Test trips and the free "Send a test" button both spend from `PROBE_SECRET`'s wallet, capped together by `PROBE_BUDGET_SOL` (tracked in Postgres). `GET /admin/probe` with `authorization: Bearer <ADMIN_TOKEN>` shows the budget, spend and wallet; nothing else exposes them.

## Limitations

- **Calibrated** means every bucket a tip at or below `TIP_CEILING_LAMPORTS` can reach has 10 probes. Reachability is decided from the live distribution: with the 1,000,000 lamport ceiling the p90 to 100 bucket of tips above the Beam floor is above the ceiling, and p75 to 90 often is too (in busy hours). Buckets above the ceiling are reported as "above tip ceiling", never quoted, never probed, and do not count toward calibration, so the calibrated state can change as the market moves.
- Beam usually lands in 3 to 6 slots at these tips, so for a 2 slot deadline the model will mostly learn that it cannot promise high confidence.
- Overpay is an estimate against the slot median; Tipwise cannot know whether a smaller tip would have landed.
- Beam tips are a small share of landed tips (one in several hundred slots), so quotes almost always use the combined distribution above the floor.
- Heat counts swaps of $100 or more, and in the measured windows heat did not reliably lead tips; the forecast only uses heat when the lag test qualifies.
- Skipped leader slots are inferred from gaps between finalized slots; none were observed in thousands of consecutive slots during development.
- The gRPC stream carries full tip transactions (about 1.7 MB/s); Yellowstone has no field projection for transactions, so it cannot be trimmed further without losing tips.
- The API needs about 0.2 of a CPU core sustained for the stream workload. Hosts with less (free web service tiers, burstable B1s VMs) let the gRPC queue grow and slots behind rise (both shown in `/health`); a B2s or any VM with a full core is enough.
- `POST /send` accepts legacy and version 0 transactions (the web3.js parser); version 1 transactions are read everywhere else.

## License

MIT
