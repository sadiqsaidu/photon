"use client";

import { pct, seconds, sol, usd } from "@/lib/format";
import type { Fare, FareId } from "@/lib/types";
import { Flaps } from "./Flap";
import s from "./FarePicker.module.css";

export function promiseText(f: Fare): string {
  return `${usd(f.tipUsd) ? `about ${usd(f.tipUsd)}` : sol(f.tipLamports)}, lands within ${seconds(f.deadlineMs)} ${pct(f.probability)} of the time${f.meetsConfidence ? "" : " (best effort)"}`;
}

export function FarePicker({ fares, value, onChange, name = "fare" }: { fares: Fare[] | null; value: FareId; onChange: (id: FareId) => void; name?: string }) {
  const list = fares ?? (["saver", "standard", "express"] as FareId[]).map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }) as Fare);
  return (
    <fieldset className={s.picker}>
      <legend className="sr-only">Fare</legend>
      {list.map((f) => {
        const ready = Boolean(fares);
        const tip = ready ? (f.tipUsd !== null ? `$${f.tipUsd.toFixed(3)}` : f.tipSol.toFixed(6)) : "";
        return (
          <label key={f.id} className={`${s.tile} ${value === f.id ? s.on : ""}`}>
            <input type="radio" name={name} value={f.id} checked={value === f.id} onChange={() => onChange(f.id)} className={s.radio} />
            <span className={s.name}>
              <Flaps text={f.label} length={8} className={s.nameFlaps} />
            </span>
            <span className={s.price}>
              <Flaps text={tip} length={6} align="right" className={s.priceFlaps} />
            </span>
            <span className={s.promise}>{ready ? promiseText(f) : "Waiting for the live fare"}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
