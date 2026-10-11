"use client";

import s from "./Odometer.module.css";

const DIGITS = "0123456789";

export function Odometer({ value, label }: { value: number; label: string }) {
  const text = value ? value.toLocaleString("en-US") : "000,000,000";
  return (
    <span className={s.odo} role="text" aria-label={label}>
      {[...text].map((ch, i) =>
        ch === "," ? (
          <span key={`c${i}`} className={s.comma} aria-hidden="true">
            ,
          </span>
        ) : (
          <span key={i} className={s.cell} aria-hidden="true">
            <span className={s.strip} style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {[...DIGITS].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ),
      )}
    </span>
  );
}
