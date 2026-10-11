import type { Metadata } from "next";
import { SendTest } from "@/components/SendTest";

export const metadata: Metadata = {
  title: "Send a test",
  description: "Send a real Solana transaction through Solami Beam at a live fare and watch it land, block by block.",
};

export default function SendPage() {
  return (
    <div className="wrap">
      <SendTest />
    </div>
  );
}
