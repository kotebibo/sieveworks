"use client";

import { use, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { initializeJobIx } from "@sieveworks/chain";
import {
  explorerTx,
  fetchChainInfo,
  fetchJob,
  fetchJobResults,
  fetchJobSwarm,
  notifyFunded,
  resultsCsvUrl,
  solStr,
  subscribeEvents,
  type JobDetail,
  type RecentResult,
} from "@/lib/api";
import { Badge, Button, LiveNum, Mono, Progress, Skeleton, fmt } from "@/components/ui";
import { Panel } from "@/components/console";
import { Sieve } from "@/components/Sieve";
import { useAuth } from "@/lib/auth";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [results, setResults] = useState<RecentResult[]>([]);
  const [cells, setCells] = useState("");

  useEffect(() => {
    const refresh = () => {
      fetchJob(id).then(setDetail).catch(() => {});
      fetchJobResults(id).then((r) => setResults(r.results)).catch(() => {});
      fetchJobSwarm(id).then((r) => setCells(r.cells)).catch(() => {});
    };
    refresh();
    return subscribeEvents((_e, data) => {
      if ((data as { job_id?: string })?.job_id === id) refresh();
    });
  }, [id]);

  if (!detail) {
    return (
      <div className="mx-auto max-w-5xl space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const states = detail.chunk_states;
  const total = Object.values(states).reduce((a, b) => a + b, 0);
  const done = states.accepted ?? 0;
  const best = results.reduce<RecentResult | null>(
    (acc, r) => (acc === null || BigInt(r.extremum_score) > BigInt(acc.extremum_score) ? r : acc),
    null
  );
  const order = ["pending", "leased", "submitted", "verifying", "challenged", "accepted", "rejected"];
  const priced = BigInt(String(detail.job.price_per_chunk_lamports ?? "0")) > 0n;

  return (
    <div className="mx-auto max-w-[1400px] space-y-3">
      {String(detail.job.status) === "draft" && priced && <FundingBanner detail={detail} id={id} />}
      {priced && detail.job.funding_signature != null && (
        <div className="panel px-4 py-2.5 num text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
          <span style={{ color: "var(--verified)" }}>✓ escrow funded</span>
          <span className="text-[var(--text-dim)]">◎{solStr(String(detail.job.budget_lamports))} locked · ◎{solStr(String(detail.job.price_per_chunk_lamports))}/chunk</span>
          <a href={explorerTx(String(detail.job.funding_signature))} target="_blank" rel="noreferrer"
            className="text-[var(--text-dim)] underline hover:text-[var(--accent)]">funding tx ↗</a>
        </div>
      )}
      <div className="panel ticked px-4 py-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">{String(detail.job.title)}</h1>
          <p className="num mt-1 text-xs text-[var(--text-dim)] flex flex-wrap gap-x-3">
            <span>{String(detail.job.game)} · {String(detail.job.version_pin)}</span>
            <span className="inline-flex gap-1">spec <Mono value={String(detail.job.worker_spec_hash)} head={10} tail={0} /></span>
          </p>
          <div className="mt-3 max-w-md"><Progress done={done} total={total} /></div>
          <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-[var(--text-dim)]"><span className="text-[var(--accent)]">{fmt(done)}</span>/{fmt(total)} chunks</span>
            {order.filter((s) => states[s]).map((s) => <span key={s}><Badge state={s} /> <LiveNum value={String(states[s])} /></span>)}
          </div>
        </div>
        <Button href="/contribute" variant="primary">▶ CONTRIBUTE</Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Panel label="◢ swarm" right={`${fmt(done)} / ${fmt(total)}`}>
          {cells ? <Sieve cells={cells} /> : <div className="h-40 skeleton" />}
        </Panel>
        <Panel label="◆ current record">
          {best ? (
            <div className="num text-sm space-y-1.5">
              <div className="font-display text-3xl" style={{ color: "var(--verified)" }}>{best.extremum_score}</div>
              <div className="text-[var(--text-dim)]">seed {best.witness_seed}</div>
              <div className="text-[var(--text-dim)] inline-flex gap-1">by <Mono value={best.wallet_address} kind="address" /></div>
            </div>
          ) : (
            <div className="text-xs text-[var(--text-faint)]">no record yet</div>
          )}
        </Panel>
      </div>

      <Panel label="◇ results export" right={`${fmt(done)} verified`}>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-[var(--text-dim)]">Download the top-scoring seeds, ranked, as CSV:</span>
          {[10, 50, 100, 500].map((n) => (
            <a key={n} href={resultsCsvUrl(id, n)}
              className="num text-[12px] px-3 py-1.5 border border-[var(--border-bright)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
              top {n} ↓
            </a>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-faint)]">
          One row per chunk-best (rank, score, seed, finder wallet, verified time). Only
          deterministically verified results are included.
        </p>
      </Panel>

      <Panel label="stream // recent results" bodyClass="p-0">
        <div className="overflow-x-auto scroll-thin">
          <table className="num w-full text-left text-xs">
            <thead className="text-[var(--text-faint)]">
              <tr className="border-b border-[var(--border)]">
                {["range", "score", "witness seed", "worker", "time", "state"].map((h) => (
                  <th key={h} className="px-4 py-1.5 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)]">
                  <td className="px-4 py-1.5 whitespace-nowrap text-[var(--text-dim)]">[{r.range_start}, {r.range_end})</td>
                  <td className="px-4 py-1.5">{r.extremum_score}</td>
                  <td className="px-4 py-1.5">{r.witness_seed}</td>
                  <td className="px-4 py-1.5"><Mono value={r.wallet_address} kind="address" /></td>
                  <td className="px-4 py-1.5 text-[var(--text-dim)]">{(r.duration_ms / 1000).toFixed(1)}s</td>
                  <td className="px-4 py-1.5"><Badge state={r.verification_state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && <p className="px-4 py-3 text-xs text-[var(--text-faint)]">no results yet</p>}
        </div>
      </Panel>
    </div>
  );
}

/** Shown while a priced job is 'draft': the escrow hasn't been funded yet.
 * Only the creator sees the action; anyone else sees the state. */
function FundingBanner({ detail, id }: { detail: JobDetail; id: string }) {
  const { wallet, token } = useAuth();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isCreator = wallet != null && wallet === String(detail.job.creator_wallet);
  const budget = BigInt(String(detail.job.budget_lamports ?? "0"));
  const price = BigInt(String(detail.job.price_per_chunk_lamports ?? "0"));

  async function fund() {
    if (!publicKey || !token) { setErr("connect the funding wallet and sign in"); return; }
    setBusy(true); setErr(null);
    try {
      const chain = await fetchChainInfo();
      if (!chain.coordinator) throw new Error("coordinator authority unavailable");
      const ix = initializeJobIx({
        jobUuid: id, funder: publicKey, coordinator: new PublicKey(chain.coordinator),
        budgetLamports: budget, pricePerChunkLamports: price,
      });
      const sig = await sendTransaction(new Transaction().add(ix), connection);
      const bh = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      const r = await notifyFunded(id, sig, token);
      if (!r.ok) throw new Error(r.error ?? "verification failed");
      // job flips to open; the SSE refresh will re-render
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel ticked px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2"
      style={{ borderColor: "var(--accent)" }}>
      <span className="barlabel" style={{ color: "var(--accent)" }}>awaiting funding</span>
      <span className="text-[13px] text-[var(--text-dim)]">
        This bounty opens once ◎{solStr(budget.toString())} is locked in its on-chain escrow
        (◎{solStr(price.toString())}/verified chunk).
      </span>
      {isCreator ? (
        <button onClick={fund} disabled={busy}
          className="sheen font-medium text-[13px] px-4 py-2 text-[var(--bg)] disabled:opacity-50" style={{ background: "var(--accent)" }}>
          {busy ? "confirming…" : `Fund ◎${solStr(budget.toString())}`}
        </button>
      ) : (
        <span className="text-xs text-[var(--text-faint)]">waiting on the funder</span>
      )}
      {err && <span className="num text-xs" style={{ color: "var(--rejected)" }}>✕ {err}</span>}
    </div>
  );
}
