"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authNonce, authVerify } from "@/lib/api";

/**
 * Wallet-native auth. Sign-In With Solana: the user signs a server nonce
 * (free, off-chain) and we store a session JWT. The token is scoped to the
 * connected wallet; disconnecting or switching wallets clears it.
 */

interface AuthState {
  wallet: string | null;
  token: string | null;
  authed: boolean;
  signingIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<AuthState>({
  wallet: null, token: null, authed: false, signingIn: false,
  signIn: async () => {}, signOut: () => {},
});

const key = (w: string) => `sieveworks_session_${w}`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, disconnect } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [token, setToken] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Restore a stored session for the connected wallet.
  useEffect(() => {
    if (!wallet) { setToken(null); return; }
    setToken(localStorage.getItem(key(wallet)));
  }, [wallet]);

  const signIn = useCallback(async () => {
    if (!wallet || !signMessage) return;
    setSigningIn(true);
    try {
      const { message } = await authNonce(wallet);
      const sig = await signMessage(new TextEncoder().encode(message));
      const { token: t } = await authVerify(wallet, message, bs58.encode(sig));
      localStorage.setItem(key(wallet), t);
      setToken(t);
    } finally {
      setSigningIn(false);
    }
  }, [wallet, signMessage]);

  const signOut = useCallback(() => {
    if (wallet) localStorage.removeItem(key(wallet));
    setToken(null);
    void disconnect();
  }, [wallet, disconnect]);

  return (
    <Ctx.Provider value={{ wallet, token, authed: !!token, signingIn, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
