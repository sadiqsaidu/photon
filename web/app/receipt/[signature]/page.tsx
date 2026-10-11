import type { Metadata } from "next";
import { ReceiptView } from "@/components/ReceiptView";

export const metadata: Metadata = { title: "Receipt", description: "When a transaction sent through Tipwise landed, or why it did not." };

export default function ReceiptPage({ params }: { params: { signature: string } }) {
  return (
    <div className="wrap">
      <ReceiptView signature={decodeURIComponent(params.signature)} />
    </div>
  );
}
