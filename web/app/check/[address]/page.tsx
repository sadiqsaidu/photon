import type { Metadata } from "next";
import { CheckResult } from "@/components/CheckResult";
import { shortAddress } from "@/lib/format";

export function generateMetadata({ params }: { params: { address: string } }): Metadata {
  return { title: `Wallet checkup ${shortAddress(params.address)}`, description: "What this wallet paid in tips compared with the going rate in the same blocks." };
}

export default function CheckAddressPage({ params }: { params: { address: string } }) {
  return (
    <div className="wrap">
      <CheckResult address={decodeURIComponent(params.address)} />
    </div>
  );
}
