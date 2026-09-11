"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { stakeIx, unstakeIx } from "@sieveworks/chain";
import { fetchStakeStatus, solStr, unstakeReq } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";

/**
 * One-time global worker bond. Staking once lets a wallet earn on ANY priced
 * bounty (the deposit is per-worker, not per-job); free bounties need no
 * stake. A caught cheat's bond is burned. Withdraw after the on-chain cooldown.
 */
export function StakePanel({ compact = false }: { compact?: boolean }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { token } = useAuth();
  const [amount, setAmount] = useState<bigint | null>(null);
  const [coordinator, setCoordinator] = useState<string | null>(null);
  const [addSol, setAddSol] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!publicKey) { setAmount(null); return; }
    fetchStakeStatus(publicKey.toBase58())
      .then((s) => { setAmount(BigInt(s.amount_lamports)); setCoordinator(s.coordinator); })
      .catch(() => setAmount(null));
  }, [publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  // Staking is a plain send (worker-only signer). Withdrawing now requires the
  // coordinator to CO-SIGN (unstake-lock): we partial-sign and hand the tx to
  // the coordinator, which co-signs only if we hold no outstanding work.
  async function send(kind: "stake" | "unstake") {
    if (!publicKey) return;
    setBusy(true); setMsg(null);
    try {
      if (kind === "stake") {
        const ix = stakeIx({ worker: publicKey, amountLamports: BigInt(Math.round((Number(addSol) || 0) * 1e9)) });
        const sig = await sendTransaction(new Transaction().add(ix), connection);
        const bh = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        setMsg("staked ✓");
      } else {
        if (!token || !signTransaction) { setMsg("sign in with this wallet to withdraw"); return; }
        if (!coordinator) { setMsg("coordinator unavailable — try again"); return; }
        const ix = unstakeIx({ worker: publicKey, coordinator: new PublicKey(coordinator) });
        const tx = new Transaction().add(ix);
        tx.feePayer = publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        const signed = await signTransaction(tx);
        const bytes = signed.serialize({ requireAllSignatures: false });
        let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
        const r = await unstakeReq(btoa(bin), token);
        if (!r.ok) throw new Error(r.outstanding ? `withdraw blocked — ${r.outstanding} chunk(s) still settling` : (r.error ?? "withdraw failed"));
        setMsg("withdrawn ✓");
      }
      setTimeout(refresh, 1200);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!publicKey) {
    return (
      <div className="text-[13px] text-[var(--text-dim)]">
        Connect a wallet to stake. A one-time bond lets you earn on paid bounties;
        free bounties need no stake.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="num text-sm">
        your bond:{" "}
        <span className="font-display text-lg" style={{ color: amount && amount > 0n ? "var(--verified)" : "var(--text-dim)" }}>
          ◎{amount !== null ? solStr(amount.toString()) : "…"}
        </span>
        {amount !== null && amount === 0n && <span className="ml-2 text-xs text-[var(--text-faint)]">not staked</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={addSol} onChange={(e) => setAddSol(e.target.value)} inputMode="decimal"
          className="num w-24 border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm rounded-lg" />
        <Button variant="primary" disabled={busy} onClick={() => void send("stake")}>
          {busy ? "confirming…" : "◈ Stake"}
        </Button>
        {amount !== null && amount > 0n && (
          <Button disabled={busy} onClick={() => void send("unstake")}>Withdraw</Button>
        )}
        {msg && <span className="num text-xs text-[var(--text-dim)]">{msg}</span>}
      </div>
      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
        One bond covers every paid bounty. Cheat and get caught → it's burned
        (sent to the incinerator, not to us or the funder). Withdrawable once
        your leases have settled and after a short cooldown.
      </p>
    </div>
  );
}
