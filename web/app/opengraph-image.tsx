import { ImageResponse } from "next/og";

export const alt = "Tipwise: the going rate to get into the next Solana block";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function font(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

const ROWS = ["SAVER", "STANDARD", "EXPRESS"];

function Flaps({ text, size, color = "#ffb21a" }: { text: string; size: number; color?: string }) {
  return (
    <div style={{ display: "flex", gap: size * 0.06 }}>
      {[...text].map((ch, i) => (
        <div
          key={i}
          style={{
            width: size * 0.66,
            height: size * 1.28,
            borderRadius: size * 0.07,
            background: "linear-gradient(to bottom, #20242a 50%, #1b1e23 50%)",
            color,
            fontFamily: "Cond",
            fontWeight: 700,
            fontSize: size,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {ch === " " ? "" : ch}
          <div style={{ position: "absolute", left: 0, right: 0, top: size * 0.64 - 0.5, height: 1, background: "#07080a" }} />
        </div>
      ))}
    </div>
  );
}

export default async function OgImage() {
  const [bold, regular] = await Promise.all([font("Barlow+Condensed", 700), font("Barlow", 500)]);
  const fonts = [
    ...(bold ? [{ name: "Cond", data: bold, weight: 700 as const }] : []),
    ...(regular ? [{ name: "Barlow", data: regular, weight: 500 as const }] : []),
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#e3e5e8", padding: "56px 64px", fontFamily: "Barlow" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Flaps text="T" size={30} />
          <div style={{ fontFamily: "Cond", fontWeight: 700, fontSize: 40, color: "#15181d" }}>Tipwise</div>
        </div>
        <div style={{ display: "flex", marginTop: 26, fontFamily: "Cond", fontWeight: 700, fontSize: 70, lineHeight: 1.02, color: "#15181d", letterSpacing: -1, width: 900 }}>
          The going rate to get into the next Solana block.
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 34,
            padding: "22px 30px",
            gap: 14,
            borderRadius: 16,
            background: "#111316",
            boxShadow: "0 24px 48px -20px rgba(12,14,18,0.6)",
          }}
        >
          {ROWS.map((r, i) => (
            <div key={r} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Flaps text={r.padEnd(8)} size={34} />
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 12, height: 12, borderRadius: 6, background: i < 2 ? "#3ddc84" : "#a8781c" }} />
                <Flaps text="LIVE" size={34} color={i < 2 ? "#ffb21a" : "#a8781c"} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: "#4b515b" }}>Live Solana tips, fares and receipts. Running on Solami.</div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
