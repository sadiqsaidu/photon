import type { Metadata } from "next";
import { DevelopersView } from "@/components/Developers";

export const metadata: Metadata = {
  title: "Developers",
  description: "Replace a hardcoded tip with the live Solana fare. SDK, curl, live console and API reference.",
};

export default function DevelopersPage() {
  return (
    <div className="wrap">
      <DevelopersView />
    </div>
  );
}
