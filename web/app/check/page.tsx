import type { Metadata } from "next";
import { CheckForm } from "@/components/CheckForm";
import s from "./check.module.css";

export const metadata: Metadata = {
  title: "Check a wallet",
  description: "See what any Solana wallet paid in tips compared with the going rate in the same blocks.",
};

export default function CheckPage() {
  return (
    <div className="wrap">
      <section className={s.intro}>
        <div className={s.copy}>
          <h1 className="h1">Check what a wallet pays to get in.</h1>
          <p className="lede">
            Paste any wallet. Tipwise reads its last 100 transactions, finds every tip, and compares each one with the tips that landed in the same
            block. You get a receipt.
          </p>
        </div>
        <div className={s.form}>
          <CheckForm autoFocus />
        </div>
      </section>
    </div>
  );
}
