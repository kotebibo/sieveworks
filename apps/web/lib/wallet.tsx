"use client";

import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { useMemo } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";
import { truncate } from "@/components/ui";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta";

/** Wallet context. Empty adapter list — modern Phantom/Solflare register via
 * the Wallet Standard and are auto-detected, so no hardware/native deps. */
export function WalletContext({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl(CLUSTER),
    []
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** Minimal connect control styled to the console. One click to connect, one to
 * disconnect — no intermediate decisions (the adapter modal handles picking). */
export function WalletButton() {
  const { publicKey, connected, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  if (connected && publicKey) {
    return (
      <button
        onClick={() => disconnect()}
        className="num text-xs px-2 py-1 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--bg)]"
        title="disconnect"
      >
        {truncate(publicKey.toBase58(), 4, 4)}
      </button>
    );
  }
  return (
    <button
      onClick={() => setVisible(true)}
      disabled={connecting}
      className="text-xs px-2 py-1 border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]"
    >
      {connecting ? "connecting…" : "connect wallet"}
    </button>
  );
}
