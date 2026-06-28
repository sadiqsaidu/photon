"use client";

import { TopBar } from "@/components/TopBar";
import { LifecycleStrip } from "@/components/LifecycleStrip";
import { StatusCards } from "@/components/StatusCards";
import { FlowCanvas } from "@/components/FlowCanvas";
import { TheMind } from "@/components/TheMind";
import { LifecycleLog } from "@/components/LifecycleLog";
import { SubmitPanel } from "@/components/SubmitPanel";

export default function Dashboard() {
  return (
    <div className="grid-bg min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-7xl space-y-4 px-5 py-5">
        <LifecycleStrip />
        <StatusCards />

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <FlowCanvas />
          </div>
          <div className="lg:row-span-2">
            <TheMind />
          </div>
          <div className="lg:col-span-2">
            <LifecycleLog />
          </div>
        </div>

        <SubmitPanel />
      </main>
    </div>
  );
}
