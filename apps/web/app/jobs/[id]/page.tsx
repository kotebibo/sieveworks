"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  fetchJob,
  fetchJobResults,
  subscribeEvents,
  truncate,
  type JobDetail,
  type RecentResult,
} from "@/lib/api";

const STATE_ORDER = ["pending", "leased", "submitted", "accepted", "rejected", "quarantined"];
const STATE_COLOR: Record<string, string> = {
  accepted: "var(--verified)",
  rejected: "var(--rejected)",
  leased: "var(--accent)",
};

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

  if (!detail) return <p className="text-sm text-[var(--muted)]">loading…</p>;

  const states = detail.chunk_states;
  const total = Object.values(states).reduce((a, b) => a + b, 0);
  const done = states.accepted ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const best = results.reduce<RecentResult | null>(
    (acc, r) => (acc === null || BigInt(r.extremum_score) > BigInt(acc.extremum_score) ? r : acc),
    null
  );

  return (
    <div className="max-w-4xl">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">{String(detail.job.title)}</h1>
        <Link href="/contribute" className="border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--background)]">
          Contribute →
        </Link>
      </div>
      <p className="num mt-1 text-xs text-[var(--muted)]">
        {String(detail.job.game)} · {String(detail.job.version_pin)} · spec {truncate(String(detail.job.worker_spec_hash), 12, 0)}
      </p>

      <div className="mt-5 h-2 w-full bg-[var(--border)]">
        <div className="h-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="num mt-2 flex flex-wrap gap-4 text-xs">
        <span>{done}/{total} chunks · {pct}%</span>
        {STATE_ORDER.filter((s) => states[s]).map((s) => (
          <span key={s} style={{ color: STATE_COLOR[s] ?? "var(--muted)" }}>
            {s} {states[s]}
          </span>
        ))}
      </div>

      {best && (
        <div className="mt-5 border border-[var(--border)] p-3 text-sm">
          <span className="text-xs uppercase tracking-wider text-[var(--muted)]">current record</span>
          <div className="num mt-1">
            score <span className="text-[var(--verified)]">{best.extremum_score}</span> · seed {best.witness_seed} · by {truncate(best.wallet_address)}
          </div>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-wider text-[var(--muted)]">recent results</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="num w-full text-left text-xs">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="py-1 pr-4 font-normal">range</th>
                <th className="py-1 pr-4 font-normal">score</th>
                <th className="py-1 pr-4 font-normal">witness seed</th>
                <th className="py-1 pr-4 font-normal">worker</th>
                <th className="py-1 pr-4 font-normal">time</th>
                <th className="py-1 font-normal">state</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-4">[{r.range_start}, {r.range_end})</td>
                  <td className="py-1.5 pr-4">{r.extremum_score}</td>
                  <td className="py-1.5 pr-4">{r.witness_seed}</td>
                  <td className="py-1.5 pr-4">{truncate(r.wallet_address)}</td>
                  <td className="py-1.5 pr-4">{(r.duration_ms / 1000).toFixed(1)}s</td>
                  <td className="py-1.5" style={{ color: r.verification_state === "passed" ? "var(--verified)" : "var(--muted)" }}>
                    {r.verification_state}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && <p className="mt-2 text-xs text-[var(--muted)]">no results yet</p>}
        </div>
      </section>
    </div>
  );
}
