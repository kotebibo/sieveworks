"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { WalletButton } from "@/lib/wallet";
import { truncate } from "@/components/ui";

/** Header auth control: connect → sign in → account. */
export function AuthButton() {
  const { wallet, authed, signingIn, signIn } = useAuth();

  if (!wallet) return <WalletButton />; // not connected → connect flow

  if (!authed) {
    return (
      <button onClick={signIn} disabled={signingIn}
        className="num text-xs px-2.5 py-1 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--bg)] disabled:opacity-50">
        {signingIn ? "sign…" : "sign in"}
      </button>
    );
  }

  return (
    <Link href="/account"
      className="num text-xs px-2.5 py-1 border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--accent)]">
      {truncate(wallet, 4, 4)}
    </Link>
  );
}
