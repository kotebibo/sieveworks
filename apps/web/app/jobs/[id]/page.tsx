"use client";

import { use, useEffect, useState } from "react";
import {
  fetchJob,
  fetchJobResults,
  subscribeEvents,
  type JobDetail,
  type RecentResult,
} from "@/lib/api";
import { Badge, Button, LiveNum, Mono, Progress, Skeleton, fmt } from "@/components/ui";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [results, setResults] = useState<RecentResult[]>([]);

  useEffect(() => {
    const refresh = () => {
      fetchJob(id).then(setDetail).catch(() => {});
      fetchJobResults(id).then((r) => setResults(r.results)).catch(() => {});
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

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{String(detail.job.title)}</h1>
          <p className="num mt-1 text-xs text-[var(--text-dim)] flex flex-wrap gap-x-3">
            <span>{String(detail.job.game)} · {String(detail.job.version_pin)}</span>
            <span className="inline-flex gap-1">spec <Mono value={String(detail.job.worker_spec_hash)} head={10} tail={0} /></span>
          </p>
        </div>
        <Button href="/contribute" variant="primary">Contribute →</Button>
      </div>

      <div className="mt-5"><Progress done={done} total={total} /></div>
      <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-[var(--text-dim)]"><span className="text-[var(--accent)]">{fmt(done)}</span>/{fmt(total)} chunks</span>
        {order.filter((s) => states[s]).map((s) => <span key={s}><Badge state={s} /> <LiveNum value={String(states[s])} /></span>)}
      </div>

      {best && (
        <div className="mt-5 panel p-3">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">current record</div>
          <div className="num mt-1 text-sm flex flex-wrap gap-x-4">
            <span>score <span className="text-[var(--verified)]">{best.extremum_score}</span></span>
            <span>seed {best.witness_seed}</span>
            <span className="inline-flex gap-1">by <Mono value={best.wallet_address} kind="address" /></span>
          </div>
        </div>
      )}

      <section className="mt-6 panel">
        <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
          recent results
        </div>
        <div className="overflow-x-auto">
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
      </section>
    </div>
  );
}
