"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { claimIx } from "@sieveworks/chain";
import {
  explorerTx, fetchClaimVoucher, fetchClaims, fetchMe, fetchNotifications, solStr, submitClaim, updateMe,
  type ClaimRow, type Me, type Notification,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Mono } from "@/components/ui";

const PREFS: [string, string][] = [
  ["records", "When I set a new record"],
  ["bounty_complete", "When a bounty I posted completes"],
  ["verified", "When my submissions are verified (noisy)"],
];

export default function Account() {
  const { authed, token, wallet, signIn, signingIn, signOut } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [email, setEmail] = useState("");
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchMe(token).then((m) => {
      setMe(m);
      setEmail(m.user.email ?? "");
      setPrefs(m.user.notify_prefs ?? {});
    }).catch(() => {});
    fetchNotifications(token).then((r) => setNotes(r.notifications)).catch(() => {});
  }, [token]);

  if (!authed) {
    return (
      <div className="mx-auto max-w-[720px] px-5 sm:px-7 py-16 text-center">
        <h1 className="font-display text-xl font-bold">Account</h1>
        <p className="mt-2 text-sm text-[var(--text-dim)]">Sign in with your wallet to manage your account.</p>
        <button onClick={signIn} disabled={signingIn}
          className="mt-4 font-medium text-[14px] px-5 py-2.5 text-[var(--bg)]" style={{ background: "var(--accent)" }}>
          {wallet ? (signingIn ? "signing…" : "Sign in") : "Connect wallet"}
        </button>
      </div>
    );
  }

  const save = async () => {
    if (!token) return;
    await updateMe(token, { email: email || null, notify_prefs: prefs });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-[720px] px-5 sm:px-7 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-tight">Account</h1>
        <button onClick={signOut} className="num text-xs px-2.5 py-1 border border-[var(--border-bright)] text-[var(--text-dim)] hover:text-[var(--rejected)] hover:border-[var(--rejected)]">sign out</button>
      </div>
      <p className="num mt-1 text-xs text-[var(--text-dim)]">
        signed in as <Mono value={wallet!} kind="address" head={6} tail={6} />
      </p>

      <section className="panel ticked p-4 mt-6">
        <div className="barlabel mb-3">Email notifications (optional)</div>
        <p className="text-[13px] text-[var(--text-dim)] mb-3">
          Add an email and we'll notify you about the events below. Your wallet stays your login —
          the email is only a contact channel.
        </p>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          className="w-full border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2 text-sm" />
        <div className="mt-3 space-y-2">
          {PREFS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-[13px] text-[var(--text-dim)]">
              <input type="checkbox" checked={prefs[k] !== false} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })}
                className="accent-[var(--accent)]" disabled={!email} />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} className="font-medium text-[13px] px-4 py-2 text-[var(--bg)]" style={{ background: "var(--accent)" }}>Save</button>
          {saved && <span className="num text-xs" style={{ color: "var(--verified)" }}>saved ✓</span>}
        </div>
      </section>

      <ClaimsSection />

      <section className="panel mt-4">
        <div className="border-b border-[var(--border)] px-4 py-2 barlabel">Notifications</div>
        <ul className="divide-y divide-[var(--border)]">
          {notes.length === 0 && <li className="px-4 py-3 text-xs text-[var(--text-faint)]">nothing yet</li>}
          {notes.map((n) => (
            <li key={n.id} className="px-4 py-2.5">
              <a href={n.link ?? "#"} className="block">
                <div className="text-[13px] font-medium">{n.title}</div>
                {n.body && <div className="text-[12px] text-[var(--text-dim)] mt-0.5">{n.body}</div>}
                <div className="num text-[10px] text-[var(--text-faint)] mt-1">{n.created_at.slice(0, 19).replace("T", " ")}</div>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** On-chain earnings claims. The wallet signs a claim tx built from a
 * coordinator voucher; the coordinator co-signs (its signature IS the payout
 * authorization) and submits. Replay-safe by cumulative arithmetic on-chain. */
function ClaimsSection() {
  const { token, wallet } = useAuth();
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [chainOn, setChainOn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ jobId: string; ok: boolean; text: string; sig?: string } | null>(null);

  const refresh = useCallback(() => {
    if (!token) return;
    fetchClaims(token).then((r) => { setClaims(r.claims); setChainOn(r.chain.enabled); }).catch(() => {});
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  const claim = async (row: ClaimRow) => {
    if (!token || !publicKey || !signTransaction) { setMsg({ jobId: row.job_id, ok: false, text: "connect the wallet you signed in with" }); return; }
    setBusy(row.job_id); setMsg(null);
    try {
      // 1. voucher: what the coordinator authorizes right now
      const v = await fetchClaimVoucher(row.job_id, token);
      if (v.error || !v.coordinator) throw new Error(v.error ?? "no voucher");
      // 2. build + sign the exact claim instruction from the voucher
      const ix = claimIx({
        jobUuid: row.job_id, worker: publicKey, coordinator: new PublicKey(v.coordinator),
        cumulativeLamports: BigInt(v.cumulative_lamports), nonce: BigInt(v.nonce),
      });
      const tx = new Transaction().add(ix);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await signTransaction(tx);
      // 3. coordinator verifies byte-for-byte, co-signs, submits
      const bytes = signed.serialize({ requireAllSignatures: false });
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      const r = await submitClaim(row.job_id, btoa(bin), token);
      if (!r.ok || !r.signature) throw new Error(r.error ?? "claim failed");
      setMsg({ jobId: row.job_id, ok: true, text: "paid to your wallet", sig: r.signature });
      refresh();
    } catch (e) {
      setMsg({ jobId: row.job_id, ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (claims.length === 0) return null;
  return (
    <section className="panel mt-4">
      <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
        <span className="barlabel">Earnings — on-chain claims</span>
        {!chainOn && <span className="num text-[11px] text-[var(--text-faint)]">chain rail offline</span>}
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {claims.map((c) => {
          const claimable = BigInt(c.cumulative_lamports) - BigInt(c.claimed_lamports);
          return (
            <li key={c.job_id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <a href={`/bounties/${c.job_id}`} className="text-[13px] font-medium hover:text-[var(--accent)]">{c.title}</a>
                <div className="num text-[12px] text-[var(--text-dim)] mt-0.5">
                  earned ◎{solStr(c.cumulative_lamports)} · claimed ◎{solStr(c.claimed_lamports)}
                </div>
              </div>
              {claimable > 0n ? (
                <span className="inline-flex items-center gap-2">
                  {BigInt(c.claimed_lamports) === 0n && claimable < 1_600_000n && (
                    <span className="num text-[11px] text-[var(--text-faint)]" title="first claim pays ~0.0015 SOL one-time account rent">below break-even</span>
                  )}
                  <button onClick={() => claim(c)} disabled={busy !== null || !chainOn}
                    className="sheen font-medium text-[13px] px-4 py-2 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
                    {busy === c.job_id ? "claiming…" : `Claim ◎${solStr(claimable.toString())}`}
                  </button>
                </span>
              ) : (
                <span className="num text-xs" style={{ color: "var(--verified)" }}>✓ fully claimed</span>
              )}
              {msg?.jobId === c.job_id && (
                <span className="num text-xs w-full" style={{ color: msg.ok ? "var(--verified)" : "var(--rejected)" }}>
                  {msg.ok ? "✓" : "✕"} {msg.text}{" "}
                  {msg.sig && <a href={explorerTx(msg.sig)} target="_blank" rel="noreferrer" className="underline">view tx ↗</a>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="px-4 py-2.5 text-[11px] text-[var(--text-faint)] border-t border-[var(--border)]">
        Claiming sends a transaction you sign together with the coordinator — its co-signature is the
        payout authorization. Earnings held to a local worker key are claimable here once that key's
        payout address is your wallet (connect your wallet on the contribute page while sieving).
        Your first claim on a job also creates its on-chain earnings account (≈◎0.0015 one-time rent,
        paid by you) — small claims are worth batching past that.
      </p>
    </section>
  );
}
