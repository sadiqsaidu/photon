"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLive } from "@/lib/live";
import { FlapTile } from "./Flap";
import { WalletMenu } from "./WalletMenu";
import s from "./TopBar.module.css";

export const NAV = [
  { href: "/", label: "Live board" },
  { href: "/check", label: "Check a wallet" },
  { href: "/send", label: "Send a test" },
  { href: "/track-record", label: "Track record" },
  { href: "/developers", label: "Developers" },
];

export function Wordmark() {
  return (
    <Link href="/" className={s.mark}>
      <FlapTile />
      <span>Tipwise</span>
    </Link>
  );
}

function LiveBlock() {
  const slot = useLive((st) => st.slot);
  const status = useLive((st) => st.status);
  const live = status === "live" && slot > 0;
  return (
    <span className={s.live}>
      <span className={`${s.dot} ${live ? s.on : ""}`} aria-hidden="true" />
      <span>{slot ? <>Block {slot.toLocaleString("en-US")}</> : "Connecting"}</span>
    </span>
  );
}

export function TopBar() {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [path]);
  return (
    <header className={s.bar}>
      <div className={`wrap ${s.inner}`}>
        <Wordmark />
        <nav className={s.nav} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={s.link} aria-current={active(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className={s.right}>
          <LiveBlock />
          <WalletMenu />
          <details className={s.more} ref={menu}>
            <summary className="btn">Menu</summary>
            <nav className={s.sheet} aria-label="Main">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={s.sheetLink} aria-current={active(n.href) ? "page" : undefined}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
