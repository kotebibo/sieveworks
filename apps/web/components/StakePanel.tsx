"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { stakeIx, unstakeIx } from "@sieveworks/chain";
import { fetchStakeStatus, solStr } from "@/lib/api";
import { Button } from "@/components/ui";

/**
 * One-time global worker bond. Staking once lets a wallet earn on ANY priced
 * bounty (the deposit is per-worker, not per-job); free bounties need no
 * stake. A caught cheat's bond is burned. Withdraw after the on-chain cooldown.
 */
export function StakePanel({ compact = false }: { compact?: boolean }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [amount, setAmount] = useState<bigint | null>(null);
  const [addSol, setAddSol] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!publicKey) { setAmount(null); return; }
    fetchStakeStatus(publicKey.toBase58())
      .then((s) => setAmount(BigInt(s.amount_lamports)))
      .catch(() => setAmount(null));
  }, [publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  async function send(kind: "stake" | "unstake") {
    if (!publicKey) return;
    setBusy(true); setMsg(null);
    try {
      const ix = kind === "stake"
        ? stakeIx({ worker: publicKey, amountLamports: BigInt(Math.round((Number(addSol) || 0) * 1e9)) })
        : unstakeIx({ worker: publicKey });
      const sig = await sendTransaction(new Transaction().add(ix), connection);
      const bh = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      setMsg(kind === "stake" ? "staked ✓" : "withdrawn ✓");
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
        (sent to the incinerator, not to us or the funder). Withdrawable after a
        short cooldown.
      </p>
    </div>
  );
}
