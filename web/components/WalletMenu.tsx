"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { shortAddress } from "@/lib/format";
import s from "./WalletMenu.module.css";

export function WalletMenu() {
  const { wallets, wallet, select, connect, disconnect, publicKey, connecting } = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const address = publicKey?.toBase58();
  return (
    <div className={s.root} ref={root}>
      <button type="button" className={`btn ${s.trigger}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {address ? (
          <>
            {wallet?.adapter.icon && <img src={wallet.adapter.icon} alt="" width={16} height={16} />}
            <span className="mono">{shortAddress(address)}</span>
          </>
        ) : connecting ? (
          "Connecting"
        ) : (
          "Connect wallet"
        )}
      </button>
      {open && (
        <div className={s.menu}>
          {address ? (
            <>
              <p className={s.note}>Connected with {wallet?.adapter.name}</p>
              <Link className={s.item} href={`/check/${address}`} onClick={() => setOpen(false)}>
                Check my wallet
              </Link>
              <Link className={s.item} href="/send" onClick={() => setOpen(false)}>
                Send a test from my wallet
              </Link>
              <button
                type="button"
                className={s.item}
                onClick={() => {
                  setOpen(false);
                  disconnect().catch(() => undefined);
                }}
              >
                Disconnect
              </button>
            </>
          ) : detected.length ? (
            <>
              <p className={s.note}>Wallets in this browser</p>
              {detected.map((w) => (
                <button
                  key={w.adapter.name}
                  type="button"
                  className={s.item}
                  onClick={() => {
                    setError(null);
                    setOpen(false);
                    if (wallet?.adapter.name === w.adapter.name) connect().catch((e: Error) => setError(e.message));
                    else select(w.adapter.name);
                  }}
                >
                  <img src={w.adapter.icon} alt="" width={20} height={20} />
                  {w.adapter.name}
                </button>
              ))}
            </>
          ) : (
            <p className={s.empty}>
              No wallet found in this browser. Install Phantom, Solflare or Backpack, or open this page in your wallet&apos;s browser.
            </p>
          )}
          {error && <p className={`${s.empty} error`}>{error}</p>}
        </div>
      )}
    </div>
  );
}
