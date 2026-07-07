"use client";

import { CommandStrip } from "@/components/deck/CommandStrip";
import { HeroStats } from "@/components/deck/HeroStats";
import { TipSurface } from "@/components/deck/TipSurface";
import { JitoWindows } from "@/components/deck/JitoWindows";
import { YourBundles } from "@/components/deck/YourBundles";
import { LeaderStrip } from "@/components/deck/LeaderStrip";
import { BuildDock } from "@/components/deck/BuildDock";
import { SystemPanel } from "@/components/deck/SystemPanel";
import { Voice } from "@/components/deck/Voice";
import { LeadersProvider } from "@/components/deck/leaders-context";

// The signal deck: numbers on the left, the living surface + firing schedule
// in the middle, timing + launch on the right, the mind's stdout underneath.
export default function Dashboard() {
  return (
    <LeadersProvider>
      <div className="flex min-h-screen flex-col">
        <CommandStrip />
        <main className="grid flex-1 grid-cols-1 gap-px bg-line/40 p-px lg:grid-cols-12">
          <div className="lg:col-span-3">
            <HeroStats />
          </div>
          <div className="flex flex-col gap-px lg:col-span-6">
            <TipSurface />
            <JitoWindows />
            <YourBundles />
          </div>
          <div className="flex flex-col gap-px lg:col-span-3">
            <LeaderStrip />
            <BuildDock />
            <SystemPanel />
          </div>
        </main>
        <Voice />
      </div>
    </LeadersProvider>
  );
}
