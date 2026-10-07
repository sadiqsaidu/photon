"use client";

import { useEffect, useState } from "react";
import type { Stats } from "@/lib/events";
import { getJson, lamports, short, solscanAccount } from "@/lib/format";

interface LeaderRow {
  identity: string;
  firstSlot: number;
  lastSlot: number;
  slotsObserved: number;
  medianTip: number | null;
  probesLanded: number;
  skipped: number;
}

export function Leaders({ stats }: { stats: Stats | null }) {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => getJson<LeaderRow[]>("/leaders").then((r) => alive && setRows(r), () => undefined);
    void load();
    const timer = setInterval(load, 8_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const slot = stats?.slot ?? 0;
  return (
    <section className="panel">
      <div className="title">
        <span className="label">upcoming leaders, next 20 slots</span>
      </div>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>slots</th>
              <th>leader</th>
              <th className="r">slots seen</th>
              <th className="r">median p50 tip</th>
              <th className="r">probes landed</th>
              <th className="r">skipped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.firstSlot} style={{ color: slot >= r.firstSlot && slot <= r.lastSlot ? "var(--gilt)" : undefined }}>
                <td>
                  {r.firstSlot.toLocaleString("en-US")}
                  {r.lastSlot > r.firstSlot ? ` +${r.lastSlot - r.firstSlot}` : ""}
                </td>
                <td>
                  <a href={solscanAccount(r.identity)} target="_blank" rel="noreferrer">
                    {short(r.identity)}
                  </a>
                </td>
                <td className="r">{r.slotsObserved}</td>
                <td className="r">{lamports(r.medianTip)}</td>
                <td className="r">{r.probesLanded}</td>
                <td className="r">{r.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted">Waiting for the leader schedule...</p>}
      </div>
    </section>
  );
}
