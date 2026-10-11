"use client";

import Link from "next/link";
import { useLive } from "@/lib/live";
import { useNow } from "@/lib/motion";
import type { ProductStatus } from "@/lib/types";
import s from "./Chrome.module.css";

const DOWN_MS = 5_000;

export function ConnectionBar() {
  const downSince = useLive((st) => st.downSince);
  const now = useNow(1_000);
  if (!downSince || now - downSince < DOWN_MS) return null;
  return (
    <div className={s.bar} role="status">
      <div className="wrap">Reconnecting to the live feed. The last values stay on screen until it is back.</div>
    </div>
  );
}

export const STATUS_WORD: Record<ProductStatus, string> = {
  live: "Live",
  reconnecting: "Reconnecting",
  refused: "Refused",
  idle: "Idle",
};

export function StatusDot({ status }: { status: ProductStatus }) {
  return <span className={`${s.status} ${s[status]}`} aria-hidden="true" />;
}

const PRODUCT_ORDER = ["Yellowstone gRPC", "Mirage", "Blur", "Beam", "RPC", "Data API", "Webhooks", "Leader tracking"];

export function Footer() {
  const products = useLive((st) => st.products);
  const byName = new Map(products.map((p) => [p.name, p]));
  return (
    <footer className={s.footer}>
      <div className="wrap">
        <div className={s.strip}>
          <Link href="/under-the-hood" className={s.title}>
            Running live on Solami
          </Link>
          <ul className={s.products}>
            {PRODUCT_ORDER.map((name) => {
              const p = byName.get(name);
              const status: ProductStatus = p?.status ?? "idle";
              return (
                <li key={name}>
                  <Link href="/under-the-hood" className={s.product} title={p?.metric}>
                    <StatusDot status={status} />
                    {name}
                    <span className="sr-only">: {STATUS_WORD[status]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <div className={s.meta}>
          <span>Built for the Solami track at the Crypto World&apos;s Fair.</span>
          <a href="https://github.com/sadiqsaidu/tipwise">Source on GitHub</a>
          <Link href="/under-the-hood">Under the hood</Link>
        </div>
      </div>
    </footer>
  );
}
