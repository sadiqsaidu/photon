"use client";

import type { WalletError } from "@solana/wallet-adapter-base";
import { WalletProvider } from "@solana/wallet-adapter-react";
import { useCallback, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const onError = useCallback((e: WalletError) => console.warn(`[wallet] ${e.name}: ${e.message}`), []);
  return (
    <WalletProvider wallets={[]} autoConnect onError={onError}>
      {children}
    </WalletProvider>
  );
}
