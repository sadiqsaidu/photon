import type { Metadata } from "next";
import { TrackRecordView } from "@/components/TrackRecord";

export const metadata: Metadata = {
  title: "Track record",
  description: "Tipwise sends real test transactions to check its own predictions. Promise versus reality, live.",
};

export default function TrackRecordPage() {
  return (
    <div className="wrap">
      <TrackRecordView />
    </div>
  );
}
