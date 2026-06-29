"use client";

import { TopBar } from "@/components/TopBar";
import { NetworkBar } from "@/components/NetworkBar";
import { StatusGrid } from "@/components/StatusGrid";
import { FlowCanvas } from "@/components/FlowCanvas";
import { TheMind } from "@/components/TheMind";
import { BundleBuilder } from "@/components/BundleBuilder";
import { BundleJourney } from "@/components/BundleJourney";
import { BundleLog } from "@/components/BundleLog";

export default function Dashboard() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <NetworkBar />
      <main className="flex-1 space-y-4 px-5 py-4">
        <StatusGrid />

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <FlowCanvas />
          </div>
          <TheMind />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <BundleJourney />
            <BundleLog />
          </div>
          <BundleBuilder />
        </div>
      </main>
    </div>
  );
}
