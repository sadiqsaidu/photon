import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import { ConnectionBar, Footer } from "@/components/Chrome";
import { Providers } from "@/components/Providers";
import { TopBar } from "@/components/TopBar";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow", display: "swap" });
const condensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-condensed", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tipwise.tech";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Tipwise: the going rate to get into the next Solana block", template: "%s | Tipwise" },
  description:
    "Tipwise watches every tip that lands in every Solana block, live, and tells you what to pay. It sends through Solami Beam, hands you a receipt, and tests its own predictions with real transactions.",
  openGraph: { siteName: "Tipwise", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#e3e5e8", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${condensed.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <Providers>
          <TopBar />
          <ConnectionBar />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
