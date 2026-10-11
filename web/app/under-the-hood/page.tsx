import type { Metadata } from "next";
import { UnderTheHoodView } from "@/components/UnderTheHood";

export const metadata: Metadata = {
  title: "Under the hood",
  description: "The eight Solami products behind Tipwise, live: Yellowstone gRPC, Mirage, Blur, Beam, RPC, Data API, Webhooks and Leader tracking.",
};

export default function UnderTheHoodPage() {
  return (
    <div className="wrap">
      <UnderTheHoodView />
    </div>
  );
}
