"use client";

import { recentLifecycles, useStore } from "@/lib/store";
import { ms } from "@/lib/format";

function Row({ k, v, tone }: { k: string; v: string; tone?: "moss" | "ember" }) {
  return (
    <div className="flex items-baseline justify-between text-[11px]">
      <span className="text-bone-faint">{k}</span>
      <span className={`tabular-nums ${tone === "moss" ? "text-moss" : tone === "ember" ? "text-ember" : "text-bone-dim"}`}>
        {v}
      </span>
    </div>
  );
}

// Vitals: the numbers an operator glances at when something feels off.
export function SystemPanel() {
  const { state } = useStore();
  const tracked = recentLifecycles(state).length;
  const race = state.race;
  const reconnects = race ? race.providers.reduce((a, p) => a + p.reconnects, 0) : 0;
  const health = state.healthMs;

  return (
    <div className="panel flex-1 p-4">
      <div className="label mb-3">system</div>
      <div className="space-y-1.5">
        <Row
          k="processed → confirmed"
          v={ms(health)}
          tone={health === null ? undefined : health < 3000 ? "moss" : "ember"}
        />
        <Row k="tracked lifecycles" v={String(tracked)} />
        <Row k="events shed" v={String(race?.dropped ?? 0)} tone={race && race.dropped > 0 ? "ember" : undefined} />
        <Row k="stream reconnects" v={String(reconnects)} tone={reconnects > 0 ? "ember" : undefined} />
        {race?.providers.map((p) => (
          <Row
            key={p.name}
            k={`${p.name.split(".").slice(-2, -1)[0] ?? p.name} last event`}
            v={`${(p.lastEventAgoMs / 1000).toFixed(1)}s ago`}
            tone={p.lastEventAgoMs > 5000 ? "ember" : "moss"}
          />
        ))}
      </div>
    </div>
  );
}
