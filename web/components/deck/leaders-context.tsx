"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchEngines, fetchLeaders, type EngineHealth, type LeadersPayload } from "@/lib/api";
import { useStore } from "@/lib/store";

interface LeadersCtx {
  leaders: LeadersPayload | null;
  engines: EngineHealth[];
  // live view of the next window, corrected by streamed slots between polls
  next: { remainingSlots: number; etaMs: number; open: boolean } | null;
}

const Ctx = createContext<LeadersCtx>({ leaders: null, engines: [], next: null });

// One poller for /leaders (5s) + /engines (15s); every deck panel that cares
// about Jito timing reads from here instead of polling on its own.
export function LeadersProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const [leaders, setLeaders] = useState<LeadersPayload | null>(null);
  const [engines, setEngines] = useState<EngineHealth[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = () => fetchLeaders().then((l) => alive && setLeaders(l)).catch(() => undefined);
    const pullEngines = () => fetchEngines().then((e) => alive && setEngines(e)).catch(() => undefined);
    pull();
    pullEngines();
    const a = setInterval(pull, 5000);
    const b = setInterval(pullEngines, 15_000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  let next: LeadersCtx["next"] = null;
  if (leaders) {
    const liveSlot = Math.max(state.slot, leaders.currentSlot);
    const slotMs = leaders.slotMs || 400;
    const w = leaders.windows.find((x) => x.end >= liveSlot) ?? null;
    if (w) {
      const remainingSlots = w.start - liveSlot;
      next = {
        remainingSlots,
        etaMs: Math.max(0, remainingSlots * slotMs),
        open: liveSlot >= w.start && liveSlot <= w.end,
      };
    }
  }

  return <Ctx.Provider value={{ leaders, engines, next }}>{children}</Ctx.Provider>;
}

export function useLeaders(): LeadersCtx {
  return useContext(Ctx);
}
