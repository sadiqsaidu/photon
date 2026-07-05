"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { PhotonEvent } from "@/lib/events";

interface Line {
  prefix: string;
  tone: "gilt" | "ember";
  text: string;
}

const TYPE_MS = 18;

// The mind's stdout: one always-on terminal line across the bottom of the
// deck that types out whatever the agent is thinking, as it thinks it.
export function Voice() {
  const { subscribe } = useStore();
  const queue = useRef<Line[]>([]);
  const [current, setCurrent] = useState<Line | null>(null);
  const [shown, setShown] = useState(0);
  const [history, setHistory] = useState<Line[]>([]);

  useEffect(() => {
    const unsub = subscribe((ev: PhotonEvent) => {
      if (ev.type === "tip_policy" && ev.reasoning) {
        queue.current.push({
          prefix: `tip policy · ${ev.anchor}×${ev.multiplier}`,
          tone: "gilt",
          text: ev.reasoning,
        });
      }
      if (ev.type === "agent" && ev.reasoning) {
        queue.current.push({
          prefix: `${ev.kind} · ${ev.action} · ${ev.signature.slice(0, 6)}…`,
          tone: "ember",
          text: ev.reasoning,
        });
      }
      // keep the queue shallow: the voice narrates, it does not backlog
      if (queue.current.length > 3) queue.current.splice(0, queue.current.length - 3);
    });
    return () => {
      unsub();
    };
  }, [subscribe]);

  useEffect(() => {
    const id = setInterval(() => {
      setShown((s) => {
        if (current && s < current.text.length) return s + 1;
        const next = queue.current.shift();
        if (next) {
          setCurrent((prev) => {
            if (prev) setHistory((h) => [prev, ...h].slice(0, 2));
            return next;
          });
          return 0;
        }
        return s;
      });
    }, TYPE_MS);
    return () => clearInterval(id);
  }, [current]);

  return (
    <footer className="sticky bottom-0 z-20 border-t border-line bg-coal/95 px-5 py-2 backdrop-blur">
      {history.map((l, i) => (
        <div key={i} className="truncate text-[10px] leading-5 text-bone-ghost">
          <span className="mr-2">▸ the mind · {l.prefix}</span>
          {l.text}
        </div>
      ))}
      <div className="flex items-baseline gap-2 text-[11.5px] leading-6">
        <span className={current?.tone === "ember" ? "text-ember" : "text-gilt"}>
          ▸ the mind{current ? ` · ${current.prefix}` : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-bone-dim">
          {current ? current.text.slice(0, shown) : "standing by — reasoning streams here as decisions are made"}
          <span className={`cursor-blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 ${current?.tone === "ember" ? "bg-ember" : "bg-gilt"}`} />
        </span>
      </div>
    </footer>
  );
}
