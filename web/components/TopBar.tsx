"use client";

import { useStore } from "@/lib/store";
import { WalletButton } from "./WalletButton";

const TABS = ["Overview", "Lifecycle Log", "Agent", "Tip Intelligence"];

export function TopBar() {
  const { state } = useStore();
  const connected = state.stream.connected;

  return (
    <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full bg-accent glow" />
        <span className="text-sm text-zinc-100">photon</span>
        <span className="chip">mainnet</span>
        <span className="ml-3 tabular-nums text-xs text-zinc-500">
          slot <span className="text-accent">{state.slot.toLocaleString()}</span>
        </span>
      </div>

      <nav className="hidden items-center gap-1 md:flex">
        {TABS.map((t, i) => (
          <span
            key={t}
            className={`rounded px-3 py-1 text-xs ${i === 0 ? "bg-white/[0.06] text-zinc-200" : "text-zinc-500"}`}
          >
            {t}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-accent live-dot" : "bg-fail"}`} />
          {connected ? "stream" : "offline"}
        </span>
        <WalletButton />
      </div>
    </header>
  );
}
