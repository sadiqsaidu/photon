import Link from "next/link";

const STAGES = ["Submitted", "Processed", "Confirmed", "Finalized"];

const FEATURES = [
  {
    title: "Live lifecycle tracking",
    body: "Every bundle is followed across processed, confirmed, and finalized — with the real latency deltas between each stage.",
  },
  {
    title: "Jito bundles, smart tips",
    body: "Tips are derived live from the Jito tip floor by an AI agent that balances cost against landing probability. No hardcoded values.",
  },
  {
    title: "Autonomous recovery",
    body: "On failure the agent reasons about the cause and decides what to change before retrying — refresh the blockhash, adjust the tip, or hold.",
  },
  {
    title: "Built on real infrastructure",
    body: "Yellowstone gRPC streaming with reconnection and backpressure handling, Jito Frankfurt submission, and proper commitment-level handling.",
  },
];

export default function Landing() {
  return (
    <main className="grid-bg min-h-screen">
      <div className="mx-auto max-w-5xl px-6">
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-accent glow" />
            <span className="text-sm tracking-wide text-zinc-100">photon</span>
            <span className="chip">mainnet</span>
          </div>
          <Link href="/dashboard" className="chip border-accent/40 text-accent hover:bg-accent/10">
            Open App →
          </Link>
        </header>

        <section className="pt-20 pb-16">
          <h1 className="max-w-3xl text-4xl leading-tight text-zinc-100 sm:text-5xl">
            A smart transaction stack for Solana.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Photon observes the network in real time over Yellowstone gRPC, submits transactions as Jito
            bundles inside the right leader window, tracks every bundle across all commitment levels, and lets
            an AI agent own the tip decision and the reasoning behind every failure.
          </p>

          <div className="mt-10 flex items-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent hover:bg-accent/20"
            >
              Open the dashboard
            </Link>
            <a
              href="https://github.com/sadiqsaidu/photon"
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              View source
            </a>
          </div>

          <div className="mt-16 flex items-center gap-3">
            {STAGES.map((s, i) => (
              <div key={s} className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full bg-accent"
                    style={{ animation: `pulse-dot 1.8s ${i * 0.4}s ease-in-out infinite` }}
                  />
                  <span className="text-xs text-zinc-400">{s}</span>
                </div>
                {i < STAGES.length - 1 && <span className="h-px w-10 bg-gradient-to-r from-accent/50 to-white/5" />}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <div className="text-sm text-zinc-200">{f.title}</div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">{f.body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
