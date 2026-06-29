import Link from "next/link";

const FEATURES = [
  {
    title: "Real-time network intelligence",
    body: "Live slot, leader, and Jito-leader detection over Yellowstone gRPC and RPC — know exactly when a Jito leader is up before you submit.",
  },
  {
    title: "AI tip intelligence",
    body: "An agent reads the live Jito tip floor and current conditions and decides your tip — balancing cost against landing probability. No hardcoded values.",
  },
  {
    title: "Full lifecycle tracking",
    body: "Every bundle is followed across processed, confirmed, and finalized with the real latency deltas — and the agent reasons about failures before retrying.",
  },
  {
    title: "Built for searchers",
    body: "Compose simple transfers or submit your own pre-signed transactions as a Jito bundle. Frankfurt block engine, client-side signing, your keys never leave the browser.",
  },
];

const SNIPPET = `// 1. build an unsigned Jito bundle (tip chosen by the agent)
const bundle = await photon.prepare({
  payer,
  payload: { kind: "sol_transfer", to, lamports },
});

// 2. sign with your wallet or keypair
const signed = await wallet.signTransaction(bundle.tx);

// 3. submit — Photon submits to Jito and tracks the lifecycle
const { bundleId } = await photon.submit(signed);`;

export default function Landing() {
  return (
    <main className="grid-bg min-h-screen">
      <div className="mx-auto max-w-5xl px-6">
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-accent glow" />
            <span className="font-semibold tracking-tight text-zinc-100">photon</span>
            <span className="chip">mainnet</span>
          </div>
          <Link href="/dashboard" className="rounded-md border border-white/10 px-3 py-1.5 text-[13px] text-zinc-300 hover:bg-white/[0.06]">
            Open App →
          </Link>
        </header>

        <section className="flex flex-col items-center pt-24 pb-16 text-center">
          <span className="chip mb-6 border-accent/30 text-accent">smart transaction stack for solana</span>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.1] tracking-tight text-zinc-50 sm:text-6xl">
            Land Jito bundles with intelligence.
          </h1>
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
            Photon observes Solana in real time, picks the right tip with an AI agent, submits your transactions as
            Jito bundles, and tracks every one across all commitment levels — built for searchers and exposed as an
            API you can automate.
          </p>
          <div className="mt-9 flex items-center gap-3">
            <Link href="/dashboard" className="rounded-lg border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-medium text-accent hover:bg-accent/20">
              Launch the dashboard
            </Link>
            <a href="https://github.com/sadiqsaidu/photon" className="rounded-lg border border-white/10 px-5 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06]">
              View source
            </a>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-500">
            <span className="chip">Yellowstone gRPC</span>
            <span className="chip">Jito Frankfurt</span>
            <span className="chip">AI tip policy</span>
            <span className="chip">client-side signing</span>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <div className="text-[15px] font-medium text-zinc-100">{f.title}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="pb-24">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">Programmable by design</h2>
            <p className="mt-2 text-[14px] text-zinc-500">
              The dashboard runs on the same API you can call directly. An SDK is on the way.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-ink-900/80 p-5 text-[12px] leading-relaxed text-zinc-300">
            <code className="font-mono">{SNIPPET}</code>
          </pre>
        </section>

        <footer className="border-t border-white/[0.06] py-8 text-center text-[12px] text-zinc-600">
          Photon · smart transaction stack · mainnet-beta
        </footer>
      </div>
    </main>
  );
}
