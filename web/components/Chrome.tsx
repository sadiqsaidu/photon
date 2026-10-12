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

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`wrap ${s.inner}`}>
        <Link href="/under-the-hood" className={`btn ${s.peek}`}>
          Peek under the hood
          <svg className={s.chevron} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div className={s.meta}>
          <a href="https://github.com/sadiqsaidu/tipwise" className={s.link}>
            GitHub
          </a>
          <a href="https://solami.dev" className={s.powered}>
            Powered by Solami
          </a>
        </div>
      </div>
    </footer>
  );
}
