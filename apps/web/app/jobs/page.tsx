"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchJobs, subscribeEvents, truncate, type JobSummary } from "@/lib/api";

export default function Jobs() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    const refresh = () => fetchJobs().then((r) => setJobs(r.jobs)).catch(() => {});
    refresh();
    return subscribeEvents(refresh, ["chunk_accepted", "job_created", "chunk_leased"]);
  }, []);

  return (
    <div className="max-w-4xl">
      <h1 className="text-lg font-semibold">Bounty board</h1>
      {jobs === null && <p className="mt-2 text-sm text-[var(--muted)]">loading…</p>}
      {jobs?.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">No open bounties.</p>}
      <div className="mt-4 space-y-3">
        {jobs?.map((j) => {
          const done = Number(j.accepted_chunks);
          const total = Number(j.total_chunks);
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <Link key={j.id} href={`/jobs/${j.id}`} className="block border border-[var(--border)] p-4 hover:border-[var(--accent)]">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{j.title}</span>
                <span className="num text-xs text-[var(--muted)]">{j.game} · {j.version_pin}</span>
              </div>
              <div className="mt-3 h-1.5 w-full bg-[var(--border)]">
                <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
              </div>
              <div className="num mt-2 flex justify-between text-xs text-[var(--muted)]">
                <span>{done}/{total} chunks · {pct}%</span>
                <span>chunk {Number(j.chunk_size).toLocaleString("en-US")} seeds · spec {truncate(j.worker_spec_hash, 8, 0)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
