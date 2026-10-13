// Reference content for the developer page. Every parameter, status code and
// field below mirrors src/routes.ts and src/server.ts; example responses are
// trimmed but structurally accurate.

export type Method = "GET" | "POST";

export interface Param {
  name: string;
  in: "path" | "query" | "body" | "header";
  type: string;
  required: boolean;
  default?: string;
  detail: string;
}

export interface Field {
  name: string;
  detail: string;
}

export interface ErrorCase {
  status: number;
  when: string;
}

export interface Endpoint {
  id: string;
  method: Method;
  path: string;
  title: string;
  purpose: string[];
  params?: Param[];
  curl: (base: string) => string;
  example?: unknown;
  exampleNote?: string;
  fields?: Field[];
  errors?: ErrorCase[];
}

export interface Group {
  id: string;
  title: string;
  intro: string[];
  endpoints: Endpoint[];
}

const SIG = "5EHzvLSo8dk6wwm5WW2FpqpRytJgdY4JF5KVkHY178ArMMKPFfJVfkFVHcsWQcAR8nNGqJgK3keAN9VPQJSG2U4R";
const WALLET = "XUrKb2aK4jBm77q75EemchVUNRTJyeFQ5KebTJygPhF";

const fareExample = (
  id: string,
  label: string,
  deadlineSlots: number,
  confidence: number,
  tip: number,
  probability: number,
  landed: number,
  bucket: { lo: number; hi: number },
  tipPercentile: number,
  probabilityAtCheaperTip: number | null,
) => ({
  id,
  label,
  deadlineSlots,
  deadlineMs: deadlineSlots * 400,
  confidence,
  tipLamports: tip,
  tipSol: tip / 1e9,
  tipUsd: Math.round((tip / 1e9) * 112 * 10_000) / 10_000,
  priorityFeeMicroLamports: 0,
  probability,
  meetsConfidence: probability >= confidence,
  bucket,
  estimate: { basis: "measured", samples: 10, landed, newestSlot: 455799012 },
  ceilingLimited: false,
  tipPercentile,
  stepApplied: false,
  probabilityAtCheaperTip,
});

const receiptExample = {
  signature: SIG,
  kind: "sdk",
  sentSlot: 455777841,
  lastValidBlockHeight: 433690512,
  tip: 109624,
  stages: {
    submitted: { slot: 455777841, ms: 0 },
    processed: { slot: 455777842, ms: 112 },
    confirmed: { slot: 455777842, ms: 231 },
    finalized: { slot: 455777842, ms: 6905 },
  },
  landedSlot: 455777842,
  failure: null,
  error: null,
  beam: { signature: SIG, is_landed: true, landed_via_jito: false, rebroadcasted: false, region: "ams", tip_lamports: 109624, first_seen_ms: 1791743411204, forwarded_ms: 1791743411205 },
  settled: true,
  sentAt: 1791743411100,
  fare: "standard",
  quotedProbability: 0.917,
  deadlineSlots: 4,
  explanation: {
    verdict: "landed",
    title: "Landed in 1 block (0.1 s).",
    whatHappened: "We estimated a 92% chance of landing within 4 blocks. It took 1, within the target.",
    whatToDo: "Nothing to fix. The tip was enough to get in on time.",
  },
};

const rateLimited = (limit: string): ErrorCase => ({ status: 429, when: `${limit}. Body: { error, retryAfterSec, reason: "ip" }.` });

export const GROUPS: Group[] = [
  {
    id: "fares",
    title: "Fares and custom quotes",
    intro: [
      "A fare is a target: a deadline in slots and the chance Tipwise aims for. GET /fares prices the three fixed fares the site shows. GET /quote prices any deadline and confidence you choose.",
      "The two price differently. Fares are market prices: fixed percentiles of today's landed tips, with the estimated chance reported for the tip that results. A custom quote works the other way round: it returns the cheapest tip whose estimated chance meets your target, projected forward by its own deadline. So GET /quote?deadline=4&confidence=0.9 usually returns a lower tip than the Standard fare even though the targets match.",
    ],
    endpoints: [
      {
        id: "get-fares",
        method: "GET",
        path: "/fares",
        title: "Live fares",
        purpose: [
          "Saver, Standard and Express, priced from where landed tips sit today: the 25th, 50th and 75th percentile of landed tips at or above the Beam minimum over the last 600 slots. Chances come from Tipwise's test trips.",
          "Each price is floored at the Beam minimum and capped at the tip ceiling. Fares are strictly ordered: if a pricier fare would not sit above the one below (for example when both land on the Beam minimum), it is raised to at least 1.25 times that fare and stepApplied is true. Each tip is the median of its last five readings (one every 2 s), rounded to two significant figures and held until the median moves more than 5%. Two fares share a price only at the ceiling, and then ceilingLimited is true.",
          "probability is the estimate for the percentile range the final tip falls in, at the fare's own deadline; meetsConfidence compares it to the fare's target. The target no longer chooses the price. A higher tip buys position when blocks get crowded, but nothing here guarantees an earlier block.",
        ],
        curl: (b) => `curl ${b}/fares`,
        example: {
          fares: [
            fareExample("saver", "Saver", 10, 0.8, 130000, 0.917, 10, { lo: 0, hi: 25 }, 25, null),
            fareExample("standard", "Standard", 4, 0.9, 300000, 0.917, 10, { lo: 25, hi: 50 }, 50, 0.917),
            fareExample("express", "Express", 2, 0.85, 700000, 0.896, 10, { lo: 50, hi: 75 }, 75, 0.896),
          ],
          pricing: "market-percentile",
          calibrated: true,
          progress: { done: 40, needed: 40 },
          samples: 1486,
          solPriceUsd: 112.07,
          forecastHorizonSlots: 0,
          tipCeilingLamports: 1000000,
          slotMs: 400,
          mood: { mood: "busy", ratio: 1.2 },
          updatedAt: 1791803636973,
        },
        fields: [
          { name: "fares[].deadlineSlots, deadlineMs", detail: "The target deadline. deadlineMs is deadlineSlots times an assumed 400 ms per slot, not a measured arrival time." },
          { name: "fares[].confidence", detail: "The target chance the fare aims for (0 to 1)." },
          { name: "fares[].tipLamports, tipSol, tipUsd", detail: "The recommended tip. tipUsd is null when the SOL price is unavailable." },
          { name: "fares[].priorityFeeMicroLamports", detail: "Compute unit price in micro-lamports per compute unit: p75 of recent prioritization fees, the same for every fare." },
          { name: "fares[].probability", detail: "Estimated chance that a transaction with this tip lands within deadlineSlots, from test trips in the tip's range." },
          { name: "fares[].meetsConfidence", detail: "true when probability is at least confidence. false means the estimate for this price falls short of the target; the price itself still follows the market." },
          { name: "fares[].bucket, estimate", detail: "Which percentile range of tips the final tip sits in, and where its estimate comes from: basis measured, inherited or prior, with samples, landed and the newest probe's slot." },
          { name: "fares[].tipPercentile", detail: "Optional. The percentile of landed tips the fare is priced at: 25, 50 or 75." },
          { name: "fares[].stepApplied", detail: "Optional. true when the fare was raised to at least 1.25 times the fare below because the two would otherwise collide." },
          { name: "fares[].ceilingLimited", detail: "true when the tip ceiling held the price below where the market percentile or the step put it." },
          { name: "fares[].probabilityAtCheaperTip", detail: "Optional. The estimate for the next cheaper fare's tip at this fare's deadline: compare it with probability to see what paying more is measured to add. null for Saver." },
          { name: "pricing", detail: "Optional. \"market-percentile\" on servers that price fares this way. Absent on older servers, which priced each fare at the cheapest range meeting its target." },
          { name: "calibrated, progress", detail: "Whether every reachable range has 10 test trips, and how many of the needed trips are done." },
          { name: "samples", detail: "Landed tips at or above the Beam minimum in the 600 slot window the prices come from." },
          { name: "mood", detail: "Median tip of the last 50 slots against the window median. Context only; it does not change the estimates." },
        ],
        errors: [{ status: 500, when: "The priority fee lookup on Solami RPC failed." }],
      },
      {
        id: "get-quote",
        method: "GET",
        path: "/quote",
        title: "Custom quote",
        purpose: [
          "A tip for any deadline and confidence, with the estimate for every percentile range so you can see what a higher tip would or would not buy.",
          "Unlike GET /fares, a quote is the cheapest range whose estimated chance meets your target. If none does, it is the cheapest tip with the best estimate and meetsConfidence is false.",
        ],
        params: [
          { name: "deadline", in: "query", type: "integer, slots", required: false, default: "2", detail: "1 to 32. Decimals are rounded." },
          { name: "confidence", in: "query", type: "number", required: false, default: "0.9", detail: "0.01 to 0.999. With 10 test trips per range the estimate tops out at 11/12 (about 0.917), so higher targets come back with meetsConfidence false." },
        ],
        curl: (b) => `curl "${b}/quote?deadline=4&confidence=0.9"`,
        example: {
          deadlineSlots: 4,
          confidence: 0.9,
          tipLamports: 103492,
          tipSol: 0.000103492,
          priorityFeeMicroLamports: 0,
          probability: 0.917,
          meetsConfidence: true,
          calibrated: true,
          bucket: { lo: 0, hi: 25 },
          estimate: { basis: "measured", samples: 10, landed: 10, newestSlot: 455799012 },
          ceilingLimited: false,
          buckets: [
            { lo: 0, hi: 25, p: 0.917, n: 10, basis: "measured", status: "reachable" },
            { lo: 25, hi: 50, p: 0.917, n: 10, basis: "measured", status: "reachable" },
            { lo: 50, hi: 75, p: 0.917, n: 10, basis: "measured", status: "reachable" },
            { lo: 75, hi: 90, p: 0.917, n: 10, basis: "measured", status: "reachable" },
            { lo: 90, hi: 100, p: 0.917, n: 0, basis: "inherited", status: "above tip ceiling" },
          ],
          tipCeilingLamports: 1000000,
          forecastHorizonSlots: 4,
          distribution: { source: "combined", samples: 1486, beamFloorPercentile: 88.1 },
          heatMultiplier: 1,
        },
        fields: [
          { name: "buckets[]", detail: "Every percentile range of tips Beam accepts, with its estimate p, test trips n, basis, and whether a tip at or below the ceiling can reach it." },
          { name: "forecastHorizonSlots", detail: "Equal to deadline for custom quotes." },
          { name: "distribution", detail: "Which landed tips the percentiles come from (Beam tips alone once there are 200, otherwise all tips at or above the Beam minimum) and where the Beam minimum sits among all landed tips." },
          { name: "heatMultiplier", detail: "1 unless the market activity lag test qualifies, in which case the price is scaled by 0.8 to 2." },
        ],
        errors: [
          { status: 400, when: "deadline or confidence is outside its range." },
          { status: 500, when: "The priority fee lookup failed." },
        ],
      },
    ],
  },
  {
    id: "transactions",
    title: "Transactions and receipts",
    intro: [
      "Tipwise never signs for you. You build and sign the transaction, including the tip transfer and the priority fee, and POST /send forwards it through Solami Beam. Then Tipwise follows it to finalized and keeps a receipt.",
    ],
    endpoints: [
      {
        id: "get-tips-addresses",
        method: "GET",
        path: "/tips/addresses",
        title: "Tip addresses",
        purpose: ["Beam tip addresses (from Solami) and the Jito tip accounts. Your tip must be a System transfer to one of the beam addresses; picking one at random spreads load."],
        curl: (b) => `curl ${b}/tips/addresses`,
        example: { beam: ["15qWd4huAkoxvhDsHMfpUn27TW1YBYMMJJ2jkAkbeam", "uiuaQsxA47JybQAVN4FTfYuoEDkMiXV1r591Aewbeam"], jito: ["96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"] },
        exampleNote: "Trimmed: the live response lists every Beam address and all 8 Jito accounts.",
      },
      {
        id: "get-blockhash",
        method: "GET",
        path: "/blockhash",
        title: "Recent blockhash",
        purpose: [
          "The blockhash of the newest confirmed block on Tipwise's stream, or getLatestBlockhash from Solami RPC before the stream has one. Browsers need no RPC key.",
          "Use it for transactions you send through Tipwise: Tipwise can only tell that a transaction expired if it saw the block that produced its blockhash.",
        ],
        curl: (b) => `curl ${b}/blockhash`,
        example: { blockhash: "5yypruMafnJW123xMKHprdw5brVcTKLm295Su4pbajGy", lastValidBlockHeight: 434063488 },
        errors: [{ status: 500, when: "No streamed blockhash yet and the RPC fallback failed." }],
      },
      {
        id: "post-send",
        method: "POST",
        path: "/send",
        title: "Send a signed transaction",
        purpose: [
          "Forwards an already signed transaction through Solami Beam (sendTransaction with skipPreflight and no retries) and starts tracking it.",
          "Tipwise does not add a tip, change the fee or rewrite the transaction. The fare label is only recorded on the receipt, with that fare's current estimate, so the receipt can say whether the target was met. Tipwise does not check that your tip matches the fare.",
        ],
        params: [
          { name: "tx", in: "body", type: "string, base64", required: true, detail: "A signed legacy or version 0 transaction. It must include a top-level System transfer of at least 100,000 lamports (0.0001 SOL) to a Beam tip address. Version 1 transactions are not accepted." },
          { name: "fare", in: "body", type: "\"saver\" | \"standard\" | \"express\"", required: false, detail: "Records the fare's target and current estimate on the receipt." },
        ],
        curl: (b) => `curl -X POST ${b}/send \\\n  -H "content-type: application/json" \\\n  -d '{"tx":"<base64 signed transaction>","fare":"standard"}'`,
        example: { signature: SIG },
        fields: [{ name: "signature", detail: "The transaction's first signature. A 200 means it was handed to Beam, not that it landed: if Beam refuses it, the receipt settles with failure send_rejected." }],
        errors: [
          { status: 400, when: "Body is not { tx }, the transaction does not deserialize, it is not signed, its Beam tip is under 100,000 lamports, or fare is not a known fare." },
          { status: 503, when: "A fare was given before the first fares were computed." },
        ],
      },
      {
        id: "get-receipt",
        method: "GET",
        path: "/receipt/:signature",
        title: "Receipt",
        purpose: ["Where a transaction sent through Tipwise is: each stage with its slot and milliseconds since send, the landed slot, a failure class, Beam's landing record and a plain English explanation. Poll until settled is true, or follow lifecycle events."],
        params: [{ name: "signature", in: "path", type: "string, base58", required: true, detail: "Signature returned by POST /send or POST /demo/send." }],
        curl: (b) => `curl ${b}/receipt/${SIG.slice(0, 12)}...`,
        example: receiptExample,
        fields: [
          { name: "stages", detail: "submitted, processed (seen in a block), confirmed and finalized, each { slot, ms }." },
          { name: "failure", detail: "null, or send_rejected (Beam refused it), failed_onchain (it landed but the program failed; tip and fee were paid), leader_skipped (the next leader skipped its slot) or expired_blockhash (no block included it before its blockhash expired)." },
          { name: "settled", detail: "true once the receipt is final and Beam's landing record has been fetched (a few seconds after landing or failing)." },
          { name: "fare, quotedProbability, deadlineSlots", detail: "The fare recorded at send time and its estimate then; null when no fare was given." },
          { name: "beam", detail: "Solami's landing record: region, whether it went through Jito, timings. null if Solami has no record." },
          { name: "explanation", detail: "{ verdict, title, whatHappened, whatToDo } built from the facts above; null while the transaction is on its way." },
        ],
        errors: [{ status: 404, when: "Tipwise did not send this signature." }],
      },
      {
        id: "post-demo-send",
        method: "POST",
        path: "/demo/send",
        title: "Free test send (site only)",
        purpose: [
          "Powers Send a test for me on this site: Tipwise builds, signs and pays for one small transaction at a fare's tip from its own wallet. It spends Tipwise's SOL, so it is rate limited and not meant for integrations. The live console on this page never calls it.",
        ],
        params: [{ name: "fare", in: "body", type: "\"saver\" | \"standard\" | \"express\"", required: false, default: "\"standard\"", detail: "Which fare's tip to send with." }],
        curl: (b) => `curl -X POST ${b}/demo/send -H "content-type: application/json" -d '{"fare":"standard"}'`,
        example: { signature: SIG, fare: "standard", quotedProbability: 0.917, deadlineSlots: 4 },
        errors: [
          { status: 400, when: "Unknown fare." },
          { status: 429, when: "reason cooldown (one test every 20 s for everyone), ip (one per address every 3 minutes), daily (the daily allowance is used) or budget (paused). Body: { error, retryAfterSec, reason }." },
          { status: 503, when: "reason disabled (no test wallet configured) or warming (fares not computed yet)." },
        ],
      },
    ],
  },
  {
    id: "wallets",
    title: "Wallet checkups and watching",
    intro: ["A checkup reads a wallet's recent transactions, finds the tip each one paid to Jito or Beam, and compares it with the tips that landed in the same slot."],
    endpoints: [
      {
        id: "post-audit",
        method: "POST",
        path: "/audit",
        title: "Run a checkup",
        purpose: ["Runs and stores a checkup. The same address within 60 seconds returns the stored checkup without running a new one (and without counting against the rate limit). A checkup takes 5 to 20 seconds."],
        params: [
          { name: "address", in: "body", type: "string, base58", required: true, detail: "Any Solana wallet." },
          { name: "limit", in: "body", type: "integer", required: false, default: "100", detail: "Transactions to read, 1 to 300." },
        ],
        curl: (b) => `curl -X POST ${b}/audit -H "content-type: application/json" \\\n  -d '{"address":"${WALLET}"}'`,
        example: {
          address: WALLET,
          limit: 100,
          historySource: "getTransactionsForAddress",
          blocksFetched: 12,
          solPriceUsd: 112.07,
          watching: false,
          updatedAt: 1791803636973,
          summary: {
            periodFrom: 1791803590,
            periodTo: 1791803593,
            totalTipsUsd: 2.24,
            goingRateLamports: 285000,
            monthlyOverpayLamports: 17_100_000_000,
            monthlyOverpayUsd: 1916.4,
            stamp: "overpaid",
            analyzed: 100,
            tipped: 45,
            benchmarked: 45,
            totalTipsLamports: 20_300_000,
            overpayLamports: 20_015_000,
            overpaySol: 0.020015,
            overpayUsd: 2.21,
            underpaidCount: 0,
            worst: [],
          },
          txs: [{ signature: SIG, slot: 455799012, blockTime: 1791803593, success: true, tip: 450000, priorityFee: 0, slotP25: 4100, slotP50: 6300, slotP75: 12000, overpay: 443700, underpaid: false }],
        },
        exampleNote: "Trimmed: txs lists every transaction read and worst lists up to 10.",
        fields: [
          { name: "summary.goingRateLamports, overpayLamports", detail: "Going rate is the median tip that landed in the same slot. Overpay is the part of each tip above it, an estimate: a smaller tip might still have landed." },
          { name: "summary.underpaidCount", detail: "Tips below the cheapest quarter of tips in their slot." },
          { name: "summary.stamp", detail: "overpaid (over 30% of tips above the going rate), too_low (over 25% of compared tips too low) or fair." },
          { name: "summary.monthlyOverpayLamports", detail: "Overpay projected over 30 days from the time span covered; null when the analyzed tips span less than 10 minutes, since a month extrapolated from a minute of trades misleads." },
          { name: "txs[].slotP25, slotP50, slotP75", detail: "Tips that landed in the same slot; null when the slot could not be compared." },
        ],
        errors: [
          { status: 400, when: "address is not a valid Solana address, or limit is not an integer from 1 to 300." },
          rateLimited("More than 6 new checkups per minute from one IP"),
        ],
      },
      {
        id: "get-audit",
        method: "GET",
        path: "/audit/:address",
        title: "Stored checkup",
        purpose: ["The last stored checkup for an address, including live updates while it is watched. Does not run a new checkup."],
        params: [{ name: "address", in: "path", type: "string, base58", required: true, detail: "Wallet address." }],
        curl: (b) => `curl ${b}/audit/${WALLET}`,
        exampleNote: "Same shape as POST /audit.",
        errors: [
          { status: 400, when: "Invalid address." },
          { status: 404, when: "No checkup stored for this address yet." },
        ],
      },
      {
        id: "post-audit-watch",
        method: "POST",
        path: "/audit/:address/watch",
        title: "Watch a wallet live",
        purpose: ["Adds a checked wallet to a Solami webhook stream for 15 minutes. Each new transaction is analysed, added to the stored checkup and published as an audit event on GET /events."],
        params: [{ name: "address", in: "path", type: "string, base58", required: true, detail: "A wallet with a stored checkup." }],
        curl: (b) => `curl -X POST ${b}/audit/${WALLET}/watch`,
        example: { address: WALLET, until: 1791804536973, delivery: "stream" },
        fields: [{ name: "until", detail: "Epoch milliseconds when watching stops. Watching again extends it." }],
        errors: [
          { status: 400, when: "Invalid address, no stored checkup for it yet, or Solami refused the webhook change." },
          rateLimited("More than 3 watch requests per minute from one IP"),
        ],
      },
      {
        id: "get-audit-examples",
        method: "GET",
        path: "/audit/examples",
        title: "Live example wallets",
        purpose: ["Up to three wallets that paid the most tips in the last 10 minutes, counted live from the gRPC stream. Tipwise's own test wallet is excluded."],
        curl: (b) => `curl ${b}/audit/examples`,
        example: [{ address: WALLET, tips: 609, lastSlot: 456026317 }],
      },
    ],
  },
  {
    id: "calibration",
    title: "Calibration and track record",
    intro: ["Tipwise sends small real test transactions (probes) to measure how often each range of tips lands in time. These endpoints show the evidence behind every estimate."],
    endpoints: [
      {
        id: "get-calibration",
        method: "GET",
        path: "/calibration",
        title: "Calibration table",
        purpose: ["Per percentile range: test trips, the estimate each trip was sent with, the share that landed within 2 slots, and the model's current estimate at 2 slots."],
        curl: (b) => `curl ${b}/calibration`,
        example: {
          deadlineSlots: 2,
          probes: 40,
          calibrated: true,
          brier: 0.126,
          buckets: [
            { lo: 0, hi: 25, n: 10, predicted: 0.5, actual: 1, model: 0.917, status: "reachable" },
            { lo: 75, hi: 90, n: 10, predicted: 0.9, actual: 0.9, model: 0.917, status: "reachable" },
            { lo: 90, hi: 100, n: 0, predicted: null, actual: null, model: 0.917, status: "above tip ceiling" },
          ],
        },
        exampleNote: "Trimmed to three of the five ranges.",
        fields: [{ name: "brier", detail: "Mean squared error of the at-send estimates against landing within 2 slots; null before any trip settles. Lower is better." }],
      },
      {
        id: "get-track-record",
        method: "GET",
        path: "/track-record",
        title: "Track record",
        purpose: [
          "Each test trip scored out of sample at the Standard deadline: the estimate the model would have given from the trips sent before it, against whether it landed within that same deadline.",
        ],
        curl: (b) => `curl ${b}/track-record`,
        example: {
          deadlineSlots: 4,
          trips: 40,
          averageGapPoints: 27.5,
          rows: [{ lo: 0, hi: 25, n: 10, promised: 0.5, delivered: 1, reachable: true }],
          testTrips: { trips: 40, landed: 40, running: false },
          recent: [{ ...receiptExample, kind: "probe", fare: null, quotedProbability: null, deadlineSlots: null }],
        },
        exampleNote: "Trimmed: rows has one entry per range and recent holds up to 30 trips.",
        fields: [
          { name: "rows[].promised, delivered", detail: "Average estimate before each trip, and the share that landed within deadlineSlots. The names are kept for compatibility; both run from 0 to 1." },
          { name: "averageGapPoints", detail: "Average absolute gap between the two, in percentage points. Too cautious and too optimistic both count." },
        ],
      },
    ],
  },
  {
    id: "health",
    title: "Health and supporting endpoints",
    intro: ["Read only views of the running service."],
    endpoints: [
      {
        id: "get-health",
        method: "GET",
        path: "/health",
        title: "Health",
        purpose: ["Stream health, kept in memory and cheap to call. ok is false when any stream is down; the webhook stream counts only while a wallet is being watched."],
        curl: (b) => `curl ${b}/health`,
        example: {
          ok: true,
          slot: 456026318,
          behind: 0,
          maxBehind: 1,
          degraded: [],
          streams: [{ name: "grpc", connected: true, reconnects: 0, lastEventAt: 1791803636973, bytes: 57217120, error: null, blocked: null, backpressureClosures: 0, queue: { depth: 0, maxDepth: 1, capacity: 50000, dropped: 0 } }],
        },
        exampleNote: "Trimmed to one of the streams.",
        fields: [
          { name: "behind, maxBehind", detail: "Slots between Tipwise's stream and Solami's chain tip, now and at worst since start." },
          { name: "degraded", detail: "Features Solami refused (missing permission, plan or balance), each { feature, error }." },
        ],
      },
      {
        id: "get-stats",
        method: "GET",
        path: "/stats",
        title: "Snapshot",
        purpose: [
          "Everything the site shows on first paint: slot and chain tip, streams, the gRPC versus Mirage race, Blur counts, the 600 slot tip window, mood, fares, SOL price, Solami product rows, calibration, track record, test trip counts and recent receipts. About 100 KB; prefer the specific endpoints.",
        ],
        curl: (b) => `curl ${b}/stats`,
      },
      {
        id: "get-leaders",
        method: "GET",
        path: "/leaders",
        title: "Upcoming leaders",
        purpose: ["The validators scheduled for the next 20 slots, grouped into runs, with what Tipwise has stored about their past slots."],
        curl: (b) => `curl ${b}/leaders`,
        example: [{ identity: "GQzMeEMwAR44ugoNCifTb5NdRKos1GduDUPeNh6AgV46", firstSlot: 456026318, lastSlot: 456026319, slotsObserved: 72, medianTip: 4868, probesLanded: 0, skipped: 0 }],
        fields: [{ name: "medianTip", detail: "Median of the per-slot median tip in this leader's stored slots, in lamports; null when none are stored." }],
      },
    ],
  },
];

export const ADMIN: Endpoint[] = [
  {
    id: "get-admin-probe",
    method: "GET",
    path: "/admin/probe",
    title: "Probe budget (operators)",
    purpose: ["The test wallet's address, budget and spend. Enabled only when ADMIN_TOKEN is set on the server; otherwise, and without the right token, it answers 404 as if it did not exist."],
    params: [{ name: "authorization", in: "header", type: "string", required: true, detail: "Bearer <ADMIN_TOKEN>." }],
    curl: (b) => `curl ${b}/admin/probe -H "authorization: Bearer $ADMIN_TOKEN"`,
    example: { wallet: "<test wallet address>", budgetLamports: 60000000, spentLamports: 9800000, leftLamports: 50200000, stopped: true, stopReason: "every reachable bucket has 10 probes" },
    errors: [{ status: 404, when: "ADMIN_TOKEN is not set, or the header does not match." }],
  },
  {
    id: "post-webhooks-solami",
    method: "POST",
    path: "/webhooks/solami",
    title: "Webhook receiver (operators)",
    purpose: [
      "Receives Solami webhook deliveries over HTTP when WEBHOOK_PUBLIC_URL is set. Tipwise normally consumes webhooks as a stream and does not need it. The body is checked against the x-webhook-signature header, which Tipwise expects to be a hex HMAC-SHA256 of the raw body keyed with the secret Solami returned when this process created the webhook (Solami documents only an HMAC of the body).",
    ],
    curl: () => "Called by Solami, not by clients.",
    errors: [{ status: 401, when: "No webhook secret is held by this process, or the signature does not match." }],
  },
];

export const EVENTS: { name: string; detail: string }[] = [
  { name: "slot", detail: "Each new processed slot: { slot, chainTip, behind }." },
  { name: "tips", detail: "Each confirmed slot: { slot, count, p25, p50, p75, p90, max, heat, dots, beam } with tips in lamports; dots and beam are up to 12 sampled tips." },
  { name: "fares", detail: "Same body as GET /fares, at most every 2 s and only when something changed." },
  { name: "quote", detail: "Every 5 s, the GET /quote result for deadline 2 at 0.9." },
  { name: "lifecycle", detail: "A receipt (same body as GET /receipt/:signature) at every stage of every send, for all senders." },
  { name: "audit", detail: "A new transaction of a watched wallet: { address, tx, summary, dropped }." },
  { name: "probe", detail: "A test trip went out: { signature, tip, fee, bucket, percentile, predicted }." },
  { name: "products", detail: "Every 5 s, the eight Solami product rows shown on Under the hood." },
  { name: "heat", detail: "Every 2 s, [slot, heat] pairs for the last 40 slots of Blur market activity." },
  { name: "lag", detail: "Every 30 s, the market activity lag test: { k, r, n, qualifies, beta, computedAt }." },
  { name: "stream", detail: "A stream connected, closed or was refused: one entry of GET /health streams." },
];

export const LIMITS: { what: string; limit: string }[] = [
  { what: "POST /audit", limit: "6 new checkups per minute per IP. A repeat within 60 s returns the stored checkup and is not counted." },
  { what: "POST /audit/:address/watch", limit: "3 per minute per IP. Each watch lasts 15 minutes." },
  { what: "POST /demo/send", limit: "One every 20 s across everyone, one per IP every 3 minutes, a daily allowance, and a total budget." },
  { what: "Request bodies", limit: "256 KB." },
];

export const ERRORS: ErrorCase[] = [
  { status: 400, when: "Invalid input. The body is not JSON, or a parameter is out of range. The message says which." },
  { status: 401, when: "Webhook receiver only: bad or missing signature." },
  { status: 404, when: "Unknown route, unknown receipt, no stored checkup, or an admin route without its token." },
  { status: 413, when: "Request body larger than 256 KB." },
  { status: 429, when: "Rate limited. The body adds retryAfterSec (seconds, or null) and reason." },
  { status: 500, when: "A Solami call failed or something unexpected happened. Retry later." },
  { status: 503, when: "Not ready or not configured: fares not computed yet, or free test sends disabled." },
];
