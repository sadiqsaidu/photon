import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Photon",
  description: "Solana tip oracle with receipts, live on Solami",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
