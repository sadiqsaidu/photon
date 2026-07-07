"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* motion helpers                                                      */
/* ------------------------------------------------------------------ */

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setShown(true);
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
    >
      {children}
    </div>
  );
}

const PHRASES = [
  "stream the chain. price the tip. fire the window.",
  "zero rpc calls on a warm submit.",
  "two grpc feeds raced, first event wins.",
  "every failure explained, then retried with intent.",
];

function Typewriter() {
  const [text, setText] = useState("");
  useEffect(() => {
    let phrase = 0;
    let i = 0;
    let deleting = false;
    const id = setInterval(() => {
      const full = PHRASES[phrase] as string;
      if (!deleting) {
        i++;
        if (i >= full.length + 24) deleting = true; // hold, then wipe
      } else {
        i -= 3;
        if (i <= 0) {
          i = 0;
          deleting = false;
          phrase = (phrase + 1) % PHRASES.length;
        }
      }
      setText(full.slice(0, Math.max(0, Math.min(i, full.length))));
    }, 45);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-bone-dim">
      {text}
      <span className="cursor-blink ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-gilt" />
    </span>
  );
}

// A simulated slot rail: cells tick past, the amber Jito window slides toward
// "now" and flashes green as it crosses, while a fake slot counter rolls.
function SlotPulse() {
  const CELLS = 64;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 400);
    return () => clearInterval(id);
  }, []);
  const windowStart = 48 - (tick % 56);
  const slot = 431_002_118 + tick;
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label">simulated slot rail</span>
        <span className="text-[11px] tabular-nums text-bone-faint">slot {slot.toLocaleString()}</span>
      </div>
      <div className="flex h-5 items-stretch gap-px">
        {Array.from({ length: CELLS }, (_, i) => {
          const inWindow = i >= windowStart && i < windowStart + 4;
          const isNow = i === 8;
          const open = inWindow && isNow;
          return (
            <span
              key={i}
              className={`flex-1 transition-colors duration-200 ${
                open ? "bg-moss" : isNow ? "bg-bone-dim" : inWindow ? "bg-gilt" : "bg-line"
              }`}
              style={{ opacity: inWindow || isNow ? 1 : Math.max(0.15, 1 - Math.abs(i - 8) * 0.02) }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-widest text-bone-ghost">
        <span>← history</span>
        <span>now</span>
        <span>jito window inbound</span>
        <span>schedule →</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* content blocks                                                      */
/* ------------------------------------------------------------------ */

function Principle({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Reveal>
      <div className="grid gap-4 border-t border-line py-8 md:grid-cols-12">
        <div className="hero-num text-[28px] !text-bone-ghost md:col-span-1">{n}</div>
        <div className="text-[15px] font-bold text-bone md:col-span-3">{title}</div>
        <p className="text-[13px] leading-relaxed text-bone-dim md:col-span-8">{children}</p>
      </div>
    </Reveal>
  );
}

function PipeNode({ tone, title, sub }: { tone: "ember" | "gilt" | "moss" | "ghost"; title: string; sub: string }) {
  const border =
    tone === "ember"
      ? "border-ember-dim"
      : tone === "gilt"
        ? "border-gilt-dim"
        : tone === "moss"
          ? "border-moss-dim"
          : "border-line";
  const text =
    tone === "ember" ? "text-ember" : tone === "gilt" ? "text-gilt" : tone === "moss" ? "text-moss" : "text-bone-dim";
  return (
    <div className={`border ${border} bg-coal-panel px-3 py-2`}>
      <div className={`text-[11px] font-bold ${text}`}>{title}</div>
      <div className="mt-0.5 text-[10px] text-bone-faint">{sub}</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="hidden flex-none items-center self-center px-1 text-[10px] text-bone-faint md:flex" aria-hidden>
      ─▸
    </div>
  );
}

function Metric({ big, label }: { big: string; label: string }) {
  return (
    <div className="panel p-5">
      <div className="hero-num text-[30px] leading-none">{big}</div>
      <div className="mt-2 text-[10px] uppercase tracking-widest text-bone-faint">{label}</div>
    </div>
  );
}

const FAILURES: [string, string][] = [
  ["expired_blockhash", "chain height passed the hash's 150-block budget — proven dead, never guessed from wall clock"],
  ["bundle_dropped", "engine accepted, auction lost — bundleStatus + a passed leader window confirm it"],
  ["leader_skipped", "the targeted validator skipped its slots; the chain jumped the window"],
  ["send_rejected", "every engine refused at the door — settled instantly, no zombie wait"],
  ["fee_too_low", "payer can't cover fees; caught in the stream's transaction error"],
  ["compute_exceeded", "blew the compute budget; caught in the stream's transaction error"],
];

/* ------------------------------------------------------------------ */
/* the page                                                            */
/* ------------------------------------------------------------------ */

export default function Home() {
  return (
    <div className="min-h-screen bg-coal">
      {/* nav */}
      <nav className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-line bg-coal/90 px-5 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-extrabold tracking-tight text-bone">photon</span>
          <span className="tag-ghost">mainnet</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#pipeline" className="hidden text-[11px] uppercase tracking-widest text-bone-faint hover:text-bone md:block">
            pipeline
          </a>
          <a href="#failures" className="hidden text-[11px] uppercase tracking-widest text-bone-faint hover:text-bone md:block">
            failures
          </a>
          <a href="#run" className="hidden text-[11px] uppercase tracking-widest text-bone-faint hover:text-bone md:block">
            run it
          </a>
          <Link
            href="/dashboard"
            className="border border-ember-dim bg-ember-deep px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-ember hover:border-ember"
          >
            open the deck →
          </Link>
        </div>
      </nav>

      {/* hero */}
      <header className="scanlines relative overflow-hidden border-b border-line px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="label mb-6">a smart transaction stack for solana searchers</p>
          <h1 className="hero-num text-[64px] leading-none tracking-tight md:text-[96px]">
            land the
            <br />
            <span className="!text-ember">bundle.</span>
          </h1>
          <p className="mt-6 h-6 max-w-xl text-[14px]">
            <Typewriter />
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="border border-ember bg-ember/10 px-5 py-3 text-[12px] font-bold uppercase tracking-widest text-ember hover:bg-ember/20"
            >
              open the deck →
            </Link>
            <a
              href="#principles"
              className="border border-line px-5 py-3 text-[12px] uppercase tracking-widest text-bone-dim hover:border-bone-faint hover:text-bone"
            >
              how it works
            </a>
          </div>
          <div className="mt-16">
            <SlotPulse />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5">
        {/* first principles */}
        <section id="principles" className="py-16">
          <Reveal>
            <h2 className="label mb-2">from first principles</h2>
            <p className="max-w-2xl text-[20px] font-bold leading-snug text-bone">
              on solana, being right isn&apos;t enough. you have to <span className="text-ember">land</span> — and
              landing is an auction held four slots at a time.
            </p>
          </Reveal>
          <div className="mt-10">
            <Principle n="01" title="the instrument">
              a jito bundle is an atomic sequence of transactions: all land in order, or none do. you attach a tip —
              a lamport transfer to one of 8 known tip accounts — and the auction decides whether your bundle makes
              the block. lose, pay nothing. win, pay the tip.
            </Principle>
            <Principle n="02" title="the two variables">
              everything reduces to <em>how much</em> and <em>when</em>. tip too little and you lose the auction; too
              much and you burn edge. and only validators running jito-solana hold the auction at all — their slots
              arrive as 4-slot windows you either hit or wait out.
            </Principle>
            <Principle n="03" title="the constraint">
              your transaction signs against a blockhash that dies 150 blocks (~a minute) after birth. every
              millisecond spent asking an rpc node what the chain looks like is spent aging your own signature.
            </Principle>
            <Principle n="04" title="photon">
              so photon never asks — it listens. two geyser gRPC feeds are raced first-event-wins; the freshest
              blockhash, the live tip market, and the full leader schedule are already in memory when you click fire.
              an llm prices the tip against a local forecast; three block-engine regions race your bundle in; and if
              anything fails, the stack proves <em>why</em> before deciding the retry.
            </Principle>
          </div>
        </section>

        {/* pipeline */}
        <section id="pipeline" className="border-t border-line py-16">
          <Reveal>
            <h2 className="label mb-8">the pipeline · every stage lives in memory</h2>
          </Reveal>
          <Reveal delay={100}>
            <div className="space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <PipeNode tone="ember" title="solinfra grpc" sub="geyser stream · slots, txs, blocks" />
                  <PipeNode tone="ember" title="helius grpc" sub="second feed · optional" />
                </div>
                <FlowArrow />
                <div className="flex-none self-center">
                  <PipeNode tone="ghost" title="race + dedup" sub="first event wins · watchdog" />
                </div>
                <FlowArrow />
                <div className="grid flex-[2] grid-cols-3 gap-2">
                  <PipeNode tone="ghost" title="blockhash cache" sub="tip-of-chain hash, zero rpc" />
                  <PipeNode tone="ghost" title="tip engine" sub="live percentiles + holt forecast" />
                  <PipeNode tone="ghost" title="leader schedule" sub="every jito window, locally" />
                </div>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
                <div className="flex-1">
                  <PipeNode tone="gilt" title="the mind" sub="llm owns tip policy + recovery · clamped, json-only" />
                </div>
                <FlowArrow />
                <div className="grid flex-[2] grid-cols-3 gap-2">
                  <PipeNode tone="ember" title="frankfurt" sub="block engine" />
                  <PipeNode tone="ember" title="amsterdam" sub="block engine" />
                  <PipeNode tone="ember" title="london" sub="block engine" />
                </div>
                <FlowArrow />
                <div className="flex-1">
                  <PipeNode tone="moss" title="the leader" sub="your bundle, in the block" />
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={200}>
            <p className="mt-6 max-w-2xl text-[12px] leading-relaxed text-bone-faint">
              submissions fan out to all regions at once — first acceptance wins, 429s put a region on cooldown, and a
              background probe keeps the fastest region first. the stream that told you about the chain is the same
              stream that confirms your landing: no polling anywhere.
            </p>
          </Reveal>
        </section>

        {/* numbers */}
        <section className="border-t border-line py-16">
          <Reveal>
            <h2 className="label mb-8">the numbers that matter</h2>
          </Reveal>
          <div className="grid grid-cols-2 gap-px md:grid-cols-3">
            {[
              ["0", "rpc calls on a warm submit"],
              ["2", "grpc feeds raced, first event wins"],
              ["8", "tip accounts watched live"],
              ["150", "blocks of blockhash lifetime, tracked exactly"],
              ["3", "block-engine regions raced per send"],
              ["~400ms", "per slot — the clock everything runs on"],
            ].map(([big, label], i) => (
              <Reveal key={label} delay={i * 60}>
                <Metric big={big as string} label={label as string} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* failures */}
        <section id="failures" className="border-t border-line py-16">
          <Reveal>
            <h2 className="label mb-2">failure, classified</h2>
            <p className="mb-8 max-w-2xl text-[13px] leading-relaxed text-bone-dim">
              most stacks call everything a timeout. photon proves the cause — precise expiry against chain height,
              bundle-status checks, leader-skip detection — and hands the verdict to the agent to decide the retry.
            </p>
          </Reveal>
          <div className="border border-line">
            {FAILURES.map(([cls, how], i) => (
              <Reveal key={cls} delay={i * 40}>
                <div className="grid gap-2 border-b border-line/60 px-4 py-3 last:border-b-0 md:grid-cols-12">
                  <span className="text-[12px] font-bold text-ember md:col-span-3">{cls}</span>
                  <span className="text-[12px] text-bone-dim md:col-span-9">{how}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* run it */}
        <section id="run" className="border-t border-line py-16">
          <Reveal>
            <h2 className="label mb-8">run it</h2>
          </Reveal>
          <Reveal delay={100}>
            <div className="panel p-5 text-[12px] leading-7">
              <p className="text-bone-ghost"># backend — stream, agent, api</p>
              <p>
                <span className="text-moss">$</span> cp .env.example .env{" "}
                <span className="text-bone-ghost"># helius rpc + solinfra grpc + one llm key</span>
              </p>
              <p>
                <span className="text-moss">$</span> docker compose up -d db && npm run db:migrate
              </p>
              <p>
                <span className="text-moss">$</span> npm run serve
              </p>
              <p className="mt-3 text-bone-ghost"># dashboard</p>
              <p>
                <span className="text-moss">$</span> cd web && npm run dev
              </p>
              <p className="mt-3 text-bone-ghost"># fault drills — watch the agent reason its way out</p>
              <p>
                <span className="text-moss">$</span> npm run fault <span className="text-bone-ghost"># expired blockhash</span>
              </p>
              <p>
                <span className="text-moss">$</span> npm run fault2{" "}
                <span className="text-bone-ghost"># minimum tip → dropped bundle</span>
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line px-5 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-3">
          <span className="text-[11px] text-bone-faint">photon — a smart transaction stack for solana searchers</span>
          <Link href="/dashboard" className="text-[11px] uppercase tracking-widest text-ember hover:text-bone">
            open the deck →
          </Link>
        </div>
      </footer>
    </div>
  );
}
