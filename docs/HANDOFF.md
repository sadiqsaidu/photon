# Photon handoff

Everything a new session (or person) needs to keep working on Photon. No secrets are in this file or the repository. Git rules are in `CLAUDE.md`: one branch (`claude/wonderful-gates-h1nwcp`), commit after every step and push, never rewrite history.

## What each file does

Backend (`src/`, TypeScript strict ESM, run with tsx in development and compiled to `dist/` for production):

| File | Role |
| --- | --- |
| `config.ts` | Env parsing, regional Solami hostnames, every constant, the one EventEmitter (`bus`) behind SSE. |
| `solami.ts` | Fetch helpers: RPC (key in query string), REST API (`x-api-key` or Bearer), Beam send and landing record, leader tracking, SOL price, webhooks, Mirage subscriptions, the proxy-aware WebSocket agent. |
| `stream.ts` | `supervise` (reconnect with backoff and jitter, staleness watchdog, refusal handling) and `wsSession` (one WebSocket session). |
| `grpc.ts` | The Yellowstone subscription, the bounded receive queue and time-sliced worker, tip extraction from balances, `from_slot` resume, closure classification. |
| `mirage.ts` | Mirage slot stream and the gRPC vs Mirage race stats. |
| `blur.ts` | Two Blur connections (swaps of $100+, launch-type events) feeding per-slot heat. |
| `tips.ts` | Per-slot tip stats, the confirmed-slot window, quote distribution above the Beam floor, lag test, Holt forecast, dashboard series. |
| `stats.ts` | Pure statistics: percentile, mid-rank, Pearson, lag correlation, Holt smoothing. |
| `quote.ts` | Landing model, bucket reachability under the tip ceiling, bucket pricing, quote, calibration and Brier score, priority fee. |
| `lifecycle.ts` | Receipt state machine (submitted, processed, confirmed, finalized), failure classes, streamed blockhash validity, `/send` submission and Beam tip parsing. |
| `probe.ts` | Budgeted probes: plan simulation, least-sampled bucket selection, spend tracking, restart reconciliation. |
| `audit.ts` | Tip Audit: wallet history, tip and priority fee per transaction, slot benchmarks (stored or `getBlock`), summary. |
| `watch.ts` | Live audits: the stream-mode Solami webhook, event queue, in-memory audits, optional HTTP delivery with HMAC. |
| `leaders.ts` | Leader schedule from `getSlotLeaders`, skipped slots from finalized gaps, per-leader stats. |
| `db.ts` | Drizzle schema, SSL-aware pool, startup migrator, retention prune, queries. |
| `server.ts` | node:http router, JSON bodies, SSE with a 15 s heartbeat. |
| `routes.ts` | Every HTTP route. |
| `sdk.ts` | Client SDK (`createPhoton`): quote, tipInstruction, send, waitForReceipt. |
| `demo.ts` | `npm run demo`: one quoted, tipped self transfer through the SDK. |
| `doctor.ts` | `npm run doctor`: checks every Solami product. |
| `main.ts` | Modes (`serve`, `doctor`, `demo`) and the wiring of streams, probes and storage. |

Other: `drizzle/` (SQL migrations, applied at startup), `test/` (vitest: quote, forecast and lag, audit math, failure classes), `render.yaml`, `docker-compose.yml` (local Postgres), `web/` (Next.js dashboard: `app/page.tsx` weather, `app/audit/page.tsx` audit, `components/` six panels, `lib/events.ts` SSE hook and state, `lib/format.ts`).

## Verified Solami endpoints and shapes

All verified live with a Pro trial key in October 2026. Regional hosts prefix the service: `ams.`, `fra.`, `nyc.` (empty for nearest).

| Endpoint | Auth | Shape and notes |
| --- | --- | --- |
| `POST https://{r}rpc.solami.dev/sol?api_key=KEY` | key in query (header auth answers 401) | Standard JSON-RPC. `getTransactionsForAddress(address, { transactionDetails: "full" or "signatures", limit <= 100, encoding: "json", maxSupportedTransactionVersion: 1, paginationToken })` returns `{ data: [ { slot, blockTime, signature, transaction, meta, version, ... } ], paginationToken }`. |
| Beam send | same RPC | `sendTransaction` with a transfer of at least 100,000 lamports to a Beam tip address is routed through Beam (`skipPreflight: true, maxRetries: 0`). |
| `GET https://api.solami.dev/onchain/tip-addresses` | none | `string[]` (15 addresses; ten end in `beam`). |
| `GET https://api.solami.dev/swqos/tx/{signature}` | none | `{ signature, is_landed, landed_via_jito, rebroadcasted, region, tip_lamports, tip_address, bundle_uuid, first_seen_ms, forwarded_ms, landed_by_venue, landed_by_signature, landed_by_slot, landed_by_tip_lamports, attributed_at, timestamp }`; 404 `{"message":"not found!"}` for unknown signatures. |
| `GET https://api.solami.dev/leader-tracking/current` | none | `{ slot, identity, validator: {...}, eta }`. Also `/leader-tracking/next?n=` and `/status`. |
| `GET https://api.solami.dev/data/token/price?chain=solana&address=MINT` | `x-api-key`, `DataApi` | Array: `[ { mint, price_usd: "116.54", price_native, quote_mint, pool, block_time } ]` (decimals are strings). |
| `wss://{r}ws.solami.dev/data/subscribe?chain=solana&api_key=KEY&type=...&min_volume_usd=...&metadata=false` | `DataApi` | JSON frames with `type`. First frame `{ type: "connected", region, filter }`; backfill then `backfill_end`. Swaps and token creations carry `slot`; surges do not. A filter that applies to one type (like `min_volume_usd`) drops all other types. |
| `https://{r}grpc.solami.dev` | `x-token` metadata | Yellowstone. `from_slot` replays up to 3,500 slots. Unary calls (`getSlot`) work without a valid key; an invalid key shows up as the subscription being cancelled (code 1) about one second after it opens, before any data. |
| `POST https://api.solami.dev/mirage/list` and `/mirage/create` | `Authorization: Bearer KEY`, `MirageView`/`MirageManage` | List is a bare array of `{ id, uid, label, filter, enabled, created_at, created_by }`; create takes `{ label, filter: { slots: true, commitment: "processed" } }`. |
| `wss://{r}ws.solami.dev/mirage/stream/{id}?api_key=KEY` | `MirageStream` | Binary protobuf `SubscribeUpdate` frames. |
| `POST https://api.solami.dev/webhooks/list`, `/create`, `/update`, `/delete` | Bearer, `WebhooksView`/`WebhooksManage` | List is a bare array. Create `{ label, addresses, stream: true, url, event_types: ["transfer"], payload_kind: "enriched", region }` returns the webhook with `secret` once. Stream-only webhooks must set `region` (ams, fra, nyc, sgp). |
| `wss://{region}.ws.solami.dev/webhooks/stream/{id}?api_key=KEY` | `WebhooksStream` | One JSON event per frame. Enriched transfer: `{ webhook_id, signature, slot, received_at, status, payload_kind, type: "transfer", source, transfers: [ { mint, native, decimals, amount, from_owner, to_owner, from_account, to_account } ], events }`. Raw: `{ ..., transaction: { fee_payer, account_keys, instructions, logs, token_balances } }` (about 11 times the bytes). |
| `GET https://api.solami.dev/pricing` | none | Live prices; gRPC PAYG $0.08/GB, Blur $0.20/GB; Pro includes 2 gRPC streams and 10 webhooks. |

WebSocket close codes: 4029 stream limit, 4002 bandwidth and balance empty, 1001 node restart.

## Gotchas we hit

- **Egress proxy and WebSockets (this cloud sandbox only).** Outbound traffic must go through an HTTP CONNECT proxy. `fetch` uses it with `NODE_USE_ENV_PROXY=1`; the `ws` library does not, and its requests got a 403 "Host not in allowlist" from the proxy, not from Solami. Fix: `new https.Agent({ proxyEnv: process.env })` passed to every WebSocket (`wsAgent` in `solami.ts`); on a normal machine it behaves as a plain agent. grpc-js honours `https_proxy` by itself.
- **grpc-js flow-control window.** The default 64 KB HTTP/2 window capped a long-haul stream (sandbox to Amsterdam) below the tip feed's rate, and the stream fell hundreds of slots behind with idle CPU. `grpc-node.flow_control_window: 16 MiB` fixed it.
- **Backpressure.** Solami closes a subscription whose client reads too slowly (the server-side buffer fills). The data callback now only enqueues; a worker processes in 8 ms slices. Protobuf decoding itself still happens inside grpc-js.
- **`failed: true` semantics.** In Yellowstone it means failed transactions only, not "include failed". Leave it unset for both, `false` for successful only. Our first wallet filter used `true` and received nothing, which looked like a Solami bug but was ours.
- **Wallet filter.** Lifecycle tracking does not use a wallet filter at all: every Photon send carries a Beam tip, so the tip-account filter sees it; failed ones come from a status-only filter on Beam tip addresses.
- **Version 1 transactions.** About half of recent transactions touching Jito tip accounts are v1. RPC refuses them unless `maxSupportedTransactionVersion: 1`. The JSON shape matches v0 plus `transactionConfig`. `@solana/web3.js` 1.x cannot deserialize v1, so `POST /send` accepts legacy and v0 only.
- **`getBlock` rejects `transactionDetails: "accounts"`** (`-32602 unknown transactionDetails`). The audit reads `"full"` blocks (0.3 to 1.3 s each).
- **yellowstone-grpc versions.** 5.0.0 is published without its build output; 6 and later use a native Rust client that does not go through the proxy. Pinned to 4.0.2 (grpc-js), loaded through `createRequire` because the ESM default export is not typed as a class.
- **drizzle-kit 0.28** could not resolve `.js` imports in TypeScript; upgraded to 0.31. Arrays in `sql` templates expand to tuples, so `unnest(array[...])` is built with `sql.join`.
- **Beam floor.** 100,000 lamports sits around p90 of all landed tips, so quotes price within tips at or above the floor; with a 1,000,000 ceiling p90 to 100 is unreachable and p75 to 90 is unreachable in busy hours (reachability is computed live).
- **Ties at 100,000 lamports.** Many tips are exactly the floor, so percentile ranks use the mid-rank, and probe tips are searched so their mid-rank lands inside the target bucket.
- **Killing processes from the agent shell.** `pkill -f` with a pattern that appears in the shell command line kills the shell itself; match with a bracket (`[p]reflight.cjs`) and keep patterns out of commit messages.

## Deployment

- **API:** Render free web service in Frankfurt from `render.yaml`. Build `npm ci --include=dev && npm run build`, start `npm start` (runs `node dist/main.js serve`), health check `/health`. Migrations run at startup.
- **Database:** Supabase Postgres (free), Session pooler URL with `?sslmode=require`. Retention keeps 3 days of `slot_stats` and 200 audits (watched ones always kept).
- **Dashboard:** Vercel, root directory `web`, `NEXT_PUBLIC_API_BASE` set to the Render URL.
- **Environment variable names (values live only in the host):** `SOLAMI_API_KEY`, `SOLAMI_REGION`, `DATABASE_URL`, `PORT` (set by Render), `PROBE_SECRET`, `PROBE_INTERVAL_SEC`, `PROBE_BUDGET_SOL`, `PROBE_LIMIT`, `TIP_CEILING_LAMPORTS`, `AUDIT_MAX_BLOCKS`, `WEBHOOK_PUBLIC_URL`, and for the web app `NEXT_PUBLIC_API_BASE`.
- Render free instances sleep after 15 minutes without requests (ping `/health` to keep them up) and have 0.1 CPU.

## Current decisions

- `TIP_CEILING_LAMPORTS=1000000`; `PROBE_BUDGET_SOL=0.024` in the development environment.
- Bucket policy (option A): only buckets reachable under the ceiling are quoted, probed and counted; calibrated means each reachable bucket has 10 probes; the others show "above tip ceiling".
- Probes: least-sampled reachable bucket first; the whole run is simulated and gated on budget before the first send; `PROBE_LIMIT` caps one process.
- Blur heat counts swaps of $100 or more (about 0.11 MB/s instead of 0.7).
- gRPC: successful tip transactions in full, failed ones only as status for Beam tip addresses, `interslotUpdates: false`.
- Region default `ams` (fastest median `getSlot` from the development sandbox; Render Frankfurt should use `fra`).
- Dashboard: heat on its own aligned strip, not a second y-axis.

## Status at handoff (October 7, 2026)

- All phases are on `claude/wonderful-gates-h1nwcp`. `npm run typecheck`, `npm test` (32 tests) and the web typecheck pass.
- `npm run doctor` passes every check with the development key.
- 10 minute verification of the compiled server (`npm start`, `PROBE_LIMIT=3`): gRPC 1.67 MB/s, Blur swaps 0.09 MB/s, Blur events 0.001 MB/s, Mirage 0.001 MB/s, webhooks 0.013 MB/s; max 1 slot behind chain tip; gRPC queue peak 1 of 50,000, nothing shed; 0 backpressure closures; one routine reconnect on Blur events; 3 probes landed through Beam (+2, +4, +5 slots).
- CPU and memory: about 21% of one core and about 280 MB RSS with the heap capped (no watched wallets). Watching a busy bot wallet adds roughly a third more CPU (about 27 `getTransaction` calls per second). Render's free 0.1 CPU is not enough; use a 0.5 CPU instance or a small VM.
- Probes: 22 sent in total, 21 landed; calibrated buckets so far p0 to 25: 5, p25 to 50: 6, p50 to 75: 8 (10 each needed). Landed spend 4,558,892 lamports; the budget counter, which also counts the one probe of unknown outcome, shows 4,863,912 spent of 24,000,000.
- The Phase 4 test webhook (`photon-audit`, watching a high-frequency bot) was deleted to save CPU; the next "watch live" recreates it.
- The Mainnet proof table in the README has placeholders for the hosted run.

## Known limitations and ideas for later

- With a 2 slot deadline most probes land in 3 to 6 slots, so the model learns that high confidence is not reachable at these tips; a longer default deadline may suit the product better.
- Heat has not shown a reliable lead in measured windows.
- Render free (0.1 CPU) may be too small for the gRPC workload; watch queue depth and slots behind in `/health`.
- Ideas: a per-leader tip model (some leaders may need less), Beam-only quotes once Beam tips are common, a `getTransfersForAddress` audit path when Solami ships it, ShredStream for earlier slot signals, exporting receipts as CSV.
