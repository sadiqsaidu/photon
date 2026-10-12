import type { Metadata } from "next";
import { DevelopersView } from "@/components/Developers";

export const metadata: Metadata = {
  title: "Developer documentation",
  description: "Tipwise API documentation: fares and quotes, sending through Solami Beam, receipts, wallet checkups, live events, calibration, errors and rate limits.",
};

export default function DevelopersPage() {
  return (
    <div className="wrap">
      <DevelopersView />
    </div>
  );
}
