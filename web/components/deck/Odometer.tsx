"use client";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ d }: { d: number }) {
  return (
    <span className="inline-block h-[1em] overflow-hidden align-baseline leading-none">
      <span className="odo-digit block" style={{ transform: `translateY(-${d}em)` }}>
        {DIGITS.map((n) => (
          <span key={n} className="block h-[1em] leading-none">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

// Slot counter with rolling digits — the deck's heartbeat.
export function Odometer({ value, className = "" }: { value: number; className?: string }) {
  if (value <= 0) {
    return <span className={`tabular-nums text-bone-ghost ${className}`}>—</span>;
  }
  const chars = value.toLocaleString("en-US").split("");
  return (
    <span className={`inline-flex tabular-nums ${className}`}>
      {chars.map((c, i) =>
        c === "," ? (
          <span key={`c${i}`} className="inline-block leading-none text-bone-faint">
            ,
          </span>
        ) : (
          <Digit key={`d${chars.length - i}`} d={Number(c)} />
        ),
      )}
    </span>
  );
}
