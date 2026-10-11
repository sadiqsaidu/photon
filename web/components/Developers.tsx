"use client";

import { Fragment, useState, type ReactNode } from "react";
import { API_BASE, api } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { FareId } from "@/lib/types";
import { FarePicker } from "./FarePicker";
import s from "./Developers.module.css";

const KEYWORDS = /^(import|from|const|await|async|new|return|export|function|let|if|else)$/;

function highlight(code: string, lang: "ts" | "sh"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = lang === "ts" ? /(\/\/[^\n]*)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d[\d_]*\b)|([A-Za-z_$][\w$]*)/g : /(#[^\n]*)|("[^"]*"|'[^']*')|(\s-{1,2}[\w-]+)|(\bcurl\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [text, comment, str, num, word] = m;
    const cls = comment ? s.c : str ? s.s : num ? s.n : word && (lang === "sh" || KEYWORDS.test(word)) ? s.k : null;
    out.push(cls ? <span key={i++} className={cls}>{text}</span> : text);
    last = m.index + text.length;
  }
  out.push(code.slice(last));
  return out;
}

function Code({ code, lang }: { code: string; lang: "ts" | "sh" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.code}>
      <button
        type="button"
        className={s.copy}
        onClick={() =>
          navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_800);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code>{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

const sdk = (base: string) => `import { createTipwise } from "./sdk"; // src/sdk.ts in the repository

const tipwise = createTipwise("${base}");
const standard = (await tipwise.fares()).find((f) => f.id === "standard")!;

// Add the tip to your own instructions, then sign as usual.
const tip = await tipwise.tipInstruction(wallet.publicKey, standard.tipLamports);

const signature = await tipwise.send(signedTx, "standard");
const receipt = await tipwise.waitForReceipt(signature);
console.log(receipt.explanation?.title); // "Landed in 3 blocks (1.2 s)."`;

const curl = (base: string) => `# 1. What this wallet paid against the going rate
curl -X POST ${base}/audit -H "content-type: application/json" \\
  -d '{"address":"<your bot wallet>"}'

# 2. The live fares (tip, priority fee, chance of landing in time)
curl ${base}/fares

# 3. Send a signed transaction that tips a Beam tip address
curl -X POST ${base}/send -H "content-type: application/json" \\
  -d '{"tx":"<base64 signed transaction>","fare":"standard"}'

# 4. The receipt, with a plain English explanation
curl ${base}/receipt/<signature>`;

const STEPS = [
  { title: "Check your bot's wallet", body: "See what it paid against the going rate. A hardcoded tip usually overpays in quiet hours and loses races in busy ones." },
  { title: "Ask for a fare", body: "GET /fares returns Saver, Standard and Express with the tip, the priority fee and the honest chance of landing in time." },
  { title: "Send through Tipwise", body: "Add the tip transfer to a Beam tip address, sign, and POST /send. Tipwise forwards it through Solami Beam." },
  { title: "Read the receipt", body: "GET /receipt/:signature (or the lifecycle stream) says when it landed or why it did not, in plain English." },
];

const ENDPOINTS: [string, string][] = [
  ["GET /fares", "Saver, Standard and Express: tip in lamports, SOL and dollars, priority fee, probability, whether it meets its promise."],
  ["GET /quote?deadline=6&confidence=0.9", "A custom quote for any deadline in slots and confidence, with per bucket detail."],
  ["POST /send", "Body { tx, fare? }. A base64 signed legacy or v0 transaction that tips at least 0.0001 SOL to a Beam tip address."],
  ["GET /receipt/:signature", "Stages with slot and ms, landed slot, failure class, Beam landing record, the promise and a plain explanation."],
  ["GET /tips/addresses", "Beam tip addresses and Jito tip accounts."],
  ["GET /blockhash", "A recent confirmed blockhash, so browsers need no RPC key."],
  ["POST /audit", "Body { address }. A wallet checkup over its last 100 transactions. 6 per minute per IP."],
  ["POST /audit/:address/watch", "Stream new transactions of a wallet onto its checkup for 15 minutes."],
  ["GET /audit/examples", "The three wallets that tipped most in the last 10 minutes."],
  ["POST /demo/send", "Body { fare }. A free test send paid by Tipwise, rate limited."],
  ["GET /track-record", "Promise versus reality and recent test trips."],
  ["GET /stats", "Everything the site shows, for a first paint."],
  ["GET /leaders", "The next block builders with their measured median tip and skipped blocks."],
  ["GET /health", "Stream health, slots behind the chain tip."],
];

const EVENTS: [string, string][] = [
  ["slot", "every new block"],
  ["tips", "each confirmed block: count, percentiles, sampled tips"],
  ["fares", "live fares, at most every 2 s when they change"],
  ["lifecycle", "every stage of every send, with its explanation"],
  ["products", "Solami product status, every 5 s"],
  ["audit", "a new transaction of a watched wallet"],
  ["probe", "a test trip went out"],
  ["heat, lag, quote, stream", "market heat, the lag test, a default quote, stream health"],
];

type ConsoleTarget = "fares" | "quote" | "examples";

export function DevelopersView() {
  const [tab, setTab] = useState<"ts" | "sh">("ts");
  const fares = useLive((st) => st.fares);
  const [target, setTarget] = useState<ConsoleTarget>("fares");
  const [fare, setFare] = useState<FareId>("standard");
  const [out, setOut] = useState<string>("");
  const [running, setRunning] = useState(false);
  const chosen = fares?.fares.find((f) => f.id === fare);
  const path =
    target === "fares" ? "/fares" : target === "examples" ? "/audit/examples" : `/quote?deadline=${chosen?.deadlineSlots ?? 6}&confidence=${chosen?.confidence ?? 0.9}`;

  const run = async () => {
    setRunning(true);
    try {
      const data = await api.raw(path);
      setOut(JSON.stringify(data, null, 2));
    } catch (e) {
      setOut(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={s.page}>
      <section className={s.intro}>
        <h1 className="h1">Make your bot tip correctly.</h1>
        <p className="lede">Replace the hardcoded tip with the live fare, send through Tipwise, and get a receipt for every transaction.</p>
      </section>

      <section className={s.block} aria-labelledby="steps-title">
        <h2 id="steps-title" className="h2">
          Four steps
        </h2>
        <ol className={s.steps}>
          {STEPS.map((st, i) => (
            <li key={st.title}>
              <span className={s.num} aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="h3">{st.title}</h3>
              <p className="muted">{st.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={s.block} aria-labelledby="code-title">
        <h2 id="code-title" className="h2">
          The code
        </h2>
        <div className={s.tabs} role="tablist" aria-label="Language">
          <button type="button" role="tab" aria-selected={tab === "ts"} className={s.tab} onClick={() => setTab("ts")}>
            TypeScript SDK
          </button>
          <button type="button" role="tab" aria-selected={tab === "sh"} className={s.tab} onClick={() => setTab("sh")}>
            curl
          </button>
        </div>
        <div role="tabpanel">{tab === "ts" ? <Code code={sdk(API_BASE)} lang="ts" /> : <Code code={curl(API_BASE)} lang="sh" />}</div>
      </section>

      <section className={s.block} aria-labelledby="console-title">
        <h2 id="console-title" className="h2">
          Live console
        </h2>
        <p className="muted" style={{ margin: "8px 0 20px" }}>
          Real responses from the Tipwise API on mainnet. Read only.
        </p>
        <div className={s.console}>
          <div className={s.controls}>
            <label className={s.select}>
              <span>Request</span>
              <select value={target} onChange={(e) => setTarget(e.target.value as ConsoleTarget)}>
                <option value="fares">The live fares</option>
                <option value="quote">A quote for one fare</option>
                <option value="examples">Live example wallets</option>
              </select>
            </label>
            {target === "quote" && <FarePicker fares={fares?.fares ?? null} value={fare} onChange={setFare} name="console-fare" />}
            <div className={s.runRow}>
              <code className={s.url}>GET {path}</code>
              <button type="button" className="btn primary" onClick={run} disabled={running}>
                {running ? "Running" : "Run"}
              </button>
            </div>
          </div>
          <pre className={s.output} aria-live="polite">
            {out || "Press Run to see the live response."}
          </pre>
        </div>
      </section>

      <section className={s.block} aria-labelledby="api-title">
        <h2 id="api-title" className="h2">
          API reference
        </h2>
        <dl className={s.ref}>
          {ENDPOINTS.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="mono">{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
        <h3 className="h3" style={{ marginTop: 40 }}>
          Live events (GET /events, server-sent events)
        </h3>
        <dl className={s.ref}>
          {EVENTS.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="mono">{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section className={s.block} aria-labelledby="own-title">
        <h2 id="own-title" className="h2">
          Run it with your own Solami key
        </h2>
        <p className="muted" style={{ marginTop: 8, maxWidth: "70ch" }}>
          Tipwise is open source. With a Solami key you can run the whole thing yourself: the streams, the API and this site. The README has the
          quick start, the key permissions and a deploy guide.{" "}
          <a href="https://github.com/sadiqsaidu/tipwise#quick-start">Open the README</a>
        </p>
      </section>
    </div>
  );
}
