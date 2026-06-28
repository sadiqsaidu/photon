import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Photon — Smart Transaction Stack",
  description: "Observe Solana in real time, submit Jito bundles, and watch an AI agent decide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
