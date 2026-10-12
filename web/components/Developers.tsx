"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";
import { ADMIN, ERRORS, EVENTS, GROUPS, LIMITS } from "./docs/content";
import { CodeBlock, CopyButton, EndpointBlock, ErrorTable, highlight } from "./docs/Docs";
import s from "./Developers.module.css";

const sdkQuickStart = (base: string) => `import { ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { createTipwise } from "./sdk"; // a copy of src/sdk.ts from the Tipwise repository

const BASE = "${base}";
const tipwise = createTipwise(BASE);

// Yours: the signer and the instructions your transaction already makes.
declare const wallet: Keypair;
declare const yourInstructions: TransactionInstruction[];

// 1. Fetch a fare.
const fare = (await tipwise.fares()).find((f) => f.id === "standard")!;

// 2. A recent blockhash from Tipwise, and a tip transfer to a random Beam tip address.
const { blockhash } = await (await fetch(\`\${BASE}/blockhash\`)).json();
const tip = await tipwise.tipInstruction(wallet.publicKey, fare.tipLamports);

// 3. Build the transaction with the fare's priority fee and tip.
const message = new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), // size this for your instructions
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fare.priorityFeeMicroLamports }),
    ...yourInstructions,
    tip,
  ],
}).compileToV0Message();

// 4. Sign it yourself (or with a wallet adapter's signTransaction).
const tx = new VersionedTransaction(message);
tx.sign([wallet]);

// 5. Submit. "standard" is recorded on the receipt; it does not change the transaction.
const signature = await tipwise.send(tx, "standard");

// 6. Wait for the settled receipt.
const receipt = await tipwise.waitForReceipt(signature);
console.log(receipt.explanation?.title, receipt.explanation?.whatToDo);`;

const curlQuickStart = (base: string) => `BASE=${base}

# 1. Fetch the fares. Note the fare's tipLamports and priorityFeeMicroLamports.
curl $BASE/fares

# 2. A recent blockhash and the Beam tip addresses.
curl $BASE/blockhash
curl $BASE/tips/addresses

# 3 and 4. Build and sign the transaction with your own tooling: a compute unit
# price of priorityFeeMicroLamports, your instructions, and a System transfer of
# tipLamports to one Beam tip address. Serialize it to base64.

# 5. Submit it.
curl -X POST $BASE/send -H "content-type: application/json" \\
  -d '{"tx":"<base64 signed transaction>","fare":"standard"}'

# 6. Follow the receipt until "settled" is true.
curl $BASE/receipt/<signature>`;

const sseExample = (base: string) => `const events = new EventSource("${base}/events");

events.addEventListener("fares", (e) => {
  const { fares } = JSON.parse(e.data);
  console.log(fares.map((f) => \`\${f.label}: \${f.tipLamports} lamports, \${f.probability}\`).join("; "));
});

events.addEventListener("lifecycle", (e) => {
  const receipt = JSON.parse(e.data);
  if (receipt.signature === mySignature && receipt.settled) console.log(receipt.explanation?.title);
});

// EventSource reconnects by itself. Events sent while disconnected are not
// replayed: after a reconnect, read GET /receipt/:signature or GET /stats to catch up.
events.onerror = () => console.warn("reconnecting to Tipwise events");`;

const STEPS = [
  { title: "Fetch a fare", body: "GET /fares, or GET /quote for your own deadline and confidence." },
  { title: "Get a blockhash and a tip address", body: "GET /blockhash and GET /tips/addresses (the SDK's tipInstruction does the second)." },
  { title: "Build the transaction", body: "Your instructions, the fare's priority fee and a transfer of the fare's tip to a Beam tip address." },
  { title: "Sign it", body: "With your own key or wallet. Tipwise never sees a private key." },
  { title: "Submit it", body: "POST /send with the base64 transaction and, optionally, the fare." },
  { title: "Read the receipt", body: "Poll GET /receipt/:signature until settled, or follow lifecycle events." },
];

const CONCEPTS: { term: string; body: string }[] = [
  { term: "Lamports, SOL and dollars", body: "1 SOL is 1,000,000,000 lamports. Tips and fees are integers in lamports. Dollar fields use the SOL price Tipwise reads from Solami's Data API every minute and are null when it is unavailable." },
  { term: "Slots and seconds", body: "Deadlines are counted in slots (blocks). Seconds such as deadlineMs assume 400 ms per slot; real slot times vary, so treat them as approximate." },
  { term: "Priority fee", body: "A compute unit price in micro-lamports per compute unit. It costs price times your compute unit limit divided by 1,000,000 lamports. Tipwise suggests p75 of recent prioritization fees, the same for every fare." },
  { term: "Tip, fee and total cost", body: "The tip is a System transfer to a Beam tip address, at least 100,000 lamports (0.0001 SOL), which Beam requires. On top come the base fee of 5,000 lamports per signature and the priority fee. Total cost is tip plus base fee plus priority fee." },
  { term: "Target confidence and estimated probability", body: "confidence is the chance a fare aims for. probability is Tipwise's estimate for the quoted tip, from real test trips. meetsConfidence is true when the estimate reaches the target; otherwise the quote is the cheapest tip with the best estimate, a best effort." },
  { term: "Estimates and calibration", body: "Each percentile range of tips Beam accepts gets an estimate from its test trips: (landed + 1) / (trips + 2), fitted so a bigger tip never shows a lower chance. Ten trips that all land give about 0.917, an estimate from ten observations, not a measured long-run rate. A range with fewer than 10 trips borrows the estimate below it (basis inherited) or uses a starting prior (basis prior). calibrated means every reachable range has 10 trips. Probes stop once calibrated, so estimates can age; newestSlot says how old the newest trip is." },
  { term: "Why fares can share a price", body: "Each fare takes the cheapest range whose estimate meets its target. When the cheapest range already meets several targets, or no pricier range shows a better estimate, those fares get the same tip." },
  { term: "A fare is not a route", body: "Every transaction goes through Solami Beam with the same priority fee. A fare label only records a target on the receipt. Two fares with the same tip are the same transaction, so a faster label adds no priority on its own." },
  { term: "Fares and custom quotes differ", body: "GET /fares prices the current window (forecastHorizonSlots 0). GET /quote projects forward by its deadline. The same deadline and confidence can therefore return a different tip from each." },
];

type Target = "fares" | "quote" | "examples" | "calibration" | "health" | "tips" | "blockhash";

const TARGETS: { id: Target; label: string }[] = [
  { id: "fares", label: "GET /fares" },
  { id: "quote", label: "GET /quote" },
  { id: "examples", label: "GET /audit/examples" },
  { id: "calibration", label: "GET /calibration" },
  { id: "tips", label: "GET /tips/addresses" },
  { id: "blockhash", label: "GET /blockhash" },
  { id: "health", label: "GET /health" },
];

type Result = { state: "idle" } | { state: "loading" } | { state: "done"; ok: boolean; status: number; ms: number; body: string };

function Console() {
  const [target, setTarget] = useState<Target>("fares");
  const [deadline, setDeadline] = useState("4");
  const [confidence, setConfidence] = useState("0.9");
  const [result, setResult] = useState<Result>({ state: "idle" });
  const path =
    target === "quote"
      ? `/quote?deadline=${encodeURIComponent(deadline)}&confidence=${encodeURIComponent(confidence)}`
      : target === "examples"
        ? "/audit/examples"
        : target === "tips"
          ? "/tips/addresses"
          : `/${target}`;
  const url = `${API_BASE}${path}`;

  const run = async () => {
    setResult({ state: "loading" });
    const started = performance.now();
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      setResult({ state: "done", ok: res.ok, status: res.status, ms: Math.round(performance.now() - started), body });
    } catch (e) {
      setResult({ state: "done", ok: false, status: 0, ms: Math.round(performance.now() - started), body: `The request did not complete: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <div className={s.console}>
      <div className={s.controls}>
        <label className={s.field}>
          <span>Endpoint</span>
          <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            {TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {target === "quote" && (
          <div className={s.pair}>
            <label className={s.field}>
              <span>deadline (slots, 1 to 32)</span>
              <input inputMode="numeric" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            <label className={s.field}>
              <span>confidence (0.01 to 0.999)</span>
              <input inputMode="decimal" value={confidence} onChange={(e) => setConfidence(e.target.value)} />
            </label>
          </div>
        )}
        <div className={s.request}>
          <code>
            <span className={s.verb}>GET</span> {url}
          </code>
          <button type="button" className="btn primary" onClick={run} disabled={result.state === "loading"}>
            {result.state === "loading" ? "Running" : "Run"}
          </button>
        </div>
        <p className="small muted">Read only. Requests go to {API_BASE} only when you press Run.</p>
      </div>
      <div className={s.output} aria-live="polite">
        <div className={s.outHead}>
          <span>
            {result.state === "idle"
              ? "Response"
              : result.state === "loading"
                ? "Loading"
                : result.status
                  ? `${result.ok ? "Success" : "Error"}: ${result.status}, ${result.ms} ms`
                  : `Failed after ${result.ms} ms`}
          </span>
          {result.state === "done" && <CopyButton text={result.body} />}
        </div>
        <pre tabIndex={0}>
          <code>
            {result.state === "done" ? (result.body.startsWith("{") || result.body.startsWith("[") ? highlight(result.body, "json") : result.body) : result.state === "loading" ? "Waiting for the response" : "Press Run to see the live response."}
          </code>
        </pre>
      </div>
    </div>
  );
}

const NAV: { id: string; label: string; children?: { id: string; label: string }[] }[] = [
  { id: "overview", label: "Overview" },
  { id: "quick-start", label: "Quick start" },
  { id: "console", label: "Live console" },
  { id: "concepts", label: "Concepts and units" },
  ...GROUPS.slice(0, 3).map((g) => ({ id: g.id, label: g.title, children: g.endpoints.map((e) => ({ id: e.id, label: `${e.method} ${e.path}` })) })),
  { id: "events", label: "Live events", children: [{ id: "get-events", label: "GET /events" }] },
  ...GROUPS.slice(3).map((g) => ({ id: g.id, label: g.title, children: g.endpoints.map((e) => ({ id: e.id, label: `${e.method} ${e.path}` })) })),
  { id: "errors", label: "Errors and rate limits" },
  { id: "self-hosting", label: "Self-hosting" },
  { id: "operators", label: "Operator endpoints", children: ADMIN.map((e) => ({ id: e.id, label: `${e.method} ${e.path}` })) },
];

function NavList() {
  return (
    <ul className={s.navList}>
      {NAV.map((n) => (
        <li key={n.id}>
          <a href={`#${n.id}`}>{n.label}</a>
          {n.children && (
            <ul>
              {n.children.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="mono">
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DevelopersView() {
  const [tab, setTab] = useState<"ts" | "sh">("ts");
  const groupSection = (i: number) => {
    const g = GROUPS[i]!;
    return (
      <section key={g.id} id={g.id} className={s.section} aria-labelledby={`${g.id}-h`}>
        <h2 id={`${g.id}-h`} className="h2">
          {g.title}
        </h2>
        {g.intro.map((p) => (
          <p key={p.slice(0, 32)} className={s.prose}>
            {p}
          </p>
        ))}
        {g.endpoints.map((e) => (
          <EndpointBlock key={e.id} e={e} base={API_BASE} />
        ))}
      </section>
    );
  };

  return (
    <div className={s.page}>
      <header className={s.intro}>
        <h1 className="h1">Developer documentation</h1>
        <p className="lede">Price a tip from live landing data, send through Solami Beam, and get a receipt for every transaction. Plain HTTP and JSON.</p>
      </header>

      <details className={s.mobileNav}>
        <summary>Contents</summary>
        <nav
          aria-label="Documentation contents"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) (e.currentTarget.parentElement as HTMLDetailsElement).open = false;
          }}
        >
          <NavList />
        </nav>
      </details>

      <div className={s.layout}>
        <nav className={s.sideNav} aria-label="Documentation sections">
          <NavList />
        </nav>

        <div className={s.content}>
          <section id="overview" className={s.section} aria-labelledby="overview-h">
            <h2 id="overview-h" className="h2">
              Overview
            </h2>
            <div className={s.base}>
              <span>Base URL</span>
              <code>{API_BASE}</code>
              <CopyButton text={API_BASE} />
            </div>
            <ul className={s.bullets}>
              <li>JSON over HTTPS. POST bodies are JSON with content-type application/json, up to 256 KB.</li>
              <li>Public endpoints need no key; Tipwise's own Solami key never leaves the server.</li>
              <li>Amounts are integers in lamports unless the field name ends in Sol or Usd. Fields ending in At are epoch milliseconds; ms and deadlineMs are durations in milliseconds; blockTime, periodFrom and periodTo are epoch seconds. Slots are Solana slot numbers.</li>
              <li>Browsers can call the API from origins the operator allows (ALLOWED_ORIGINS; every origin when unset).</li>
              <li>There is no pagination: list endpoints return bounded lists.</li>
            </ul>
          </section>

          <section id="quick-start" className={s.section} aria-labelledby="quick-start-h">
            <h2 id="quick-start-h" className="h2">
              Quick start
            </h2>
            <p className={s.prose}>
              Replace a hardcoded tip with a live fare. The SDK is a single file, <code>src/sdk.ts</code> in the repository, whose only dependency is{" "}
              <code>@solana/web3.js</code>. It is not published to npm, so copy it into your project.
            </p>
            <ol className={s.steps}>
              {STEPS.map((st, i) => (
                <li key={st.title}>
                  <span className={s.num} aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <strong>{st.title}</strong>
                    <p>{st.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className={s.tabs} role="tablist" aria-label="Quick start language">
              <button type="button" role="tab" id="tab-ts" aria-controls="panel-qs" aria-selected={tab === "ts"} className={s.tab} onClick={() => setTab("ts")}>
                TypeScript SDK
              </button>
              <button type="button" role="tab" id="tab-sh" aria-controls="panel-qs" aria-selected={tab === "sh"} className={s.tab} onClick={() => setTab("sh")}>
                curl
              </button>
            </div>
            <div role="tabpanel" id="panel-qs" aria-labelledby={tab === "ts" ? "tab-ts" : "tab-sh"}>
              {tab === "ts" ? <CodeBlock code={sdkQuickStart(API_BASE)} lang="ts" /> : <CodeBlock code={curlQuickStart(API_BASE)} lang="sh" />}
            </div>
          </section>

          <section id="console" className={s.section} aria-labelledby="console-h">
            <h2 id="console-h" className="h2">
              Live console
            </h2>
            <p className={s.prose}>Send a read-only request to the API this site uses and see the real response.</p>
            <Console />
          </section>

          <section id="concepts" className={s.section} aria-labelledby="concepts-h">
            <h2 id="concepts-h" className="h2">
              Concepts and units
            </h2>
            <dl className={s.concepts}>
              {CONCEPTS.map((c) => (
                <div key={c.term}>
                  <dt>{c.term}</dt>
                  <dd>{c.body}</dd>
                </div>
              ))}
            </dl>
          </section>

          {[0, 1, 2].map(groupSection)}

          <section id="events" className={s.section} aria-labelledby="events-h">
            <h2 id="events-h" className="h2">
              Live events
            </h2>
            <article id="get-events" className={s.endpointLike}>
              <p className={s.prose}>
                <code>GET /events</code> is a server-sent event stream. Each message has an event name and a JSON data line. The stream opens with a{" "}
                <code>: tipwise</code> comment and sends a <code>: ping</code> comment every 15 seconds. Events carry no ids and nothing is replayed: a client
                that reconnects only gets events from then on.
              </p>
              <CodeBlock code={sseExample(API_BASE)} lang="js" />
              <table className={s.eventTable}>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">When and what</th>
                  </tr>
                </thead>
                <tbody>
                  {EVENTS.map((e) => (
                    <tr key={e.name}>
                      <td data-label="Event">
                        <code>{e.name}</code>
                      </td>
                      <td data-label="When and what">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </section>

          {[3, 4].map(groupSection)}

          <section id="errors" className={s.section} aria-labelledby="errors-h">
            <h2 id="errors-h" className="h2">
              Errors and rate limits
            </h2>
            <p className={s.prose}>
              Errors are JSON: <code>{"{ \"error\": \"message\" }"}</code>, plus <code>retryAfterSec</code> and <code>reason</code> on 429 responses.
            </p>
            <ErrorTable errors={ERRORS} />
            <h3 className={`h3 ${s.sub}`}>Rate limits</h3>
            <table className={s.eventTable}>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Limit</th>
                </tr>
              </thead>
              <tbody>
                {LIMITS.map((l) => (
                  <tr key={l.what}>
                    <td data-label="What">
                      <code>{l.what}</code>
                    </td>
                    <td data-label="Limit">{l.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={s.prose}>Limits are per IP as seen by the server (the first x-forwarded-for entry behind its reverse proxy) and are kept in memory, so they reset when the server restarts.</p>
          </section>

          <section id="self-hosting" className={s.section} aria-labelledby="self-hosting-h">
            <h2 id="self-hosting-h" className="h2">
              Self-hosting
            </h2>
            <p className={s.prose}>
              Tipwise is open source. With your own Solami key you run the streams, the API and this site. Point the site at your API with{" "}
              <code>NEXT_PUBLIC_API_BASE</code>; every example on this page uses that base URL.
            </p>
            <CodeBlock
              lang="sh"
              code={`git clone https://github.com/sadiqsaidu/tipwise.git && cd tipwise
npm install
cp .env.example .env      # set SOLAMI_API_KEY (PROBE_SECRET only if you want test trips)
docker compose up -d db   # local Postgres
npm run serve             # API and streams on http://localhost:8080

cd web && npm install
NEXT_PUBLIC_API_BASE=http://localhost:8080 npm run dev`}
            />
            <p className={s.prose}>
              The README covers the key permissions, every environment variable and a production deploy:{" "}
              <a href="https://github.com/sadiqsaidu/tipwise#quick-start">Quick start</a> and <a href="https://github.com/sadiqsaidu/tipwise#deploy">Deploy</a>.
            </p>
          </section>

          <section id="operators" className={s.section} aria-labelledby="operators-h">
            <h2 id="operators-h" className="h2">
              Operator endpoints
            </h2>
            <p className={s.prose}>For people running their own Tipwise server. Integrations do not need these.</p>
            {ADMIN.map((e) => (
              <EndpointBlock key={e.id} e={e} base={API_BASE} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
