"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchJobs, subscribeEvents, type JobSummary } from "@/lib/api";
import { Button, Mono, Progress, Skeleton, fmt } from "@/components/ui";

export default function Jobs() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    const refresh = () => fetchJobs().then((r) => setJobs(r.jobs)).catch(() => setJobs([]));
    refresh();
    return subscribeEvents(refresh, ["chunk_accepted", "job_created", "chunk_leased", "chunk_rejected"]);
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Bounty board</h1>
        <Button href="/jobs/new" variant="ghost">+ Post a bounty</Button>
      </div>

      {jobs === null && (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      )}
      {jobs?.length === 0 && <p className="mt-4 text-sm text-[var(--text-dim)]">No open bounties yet.</p>}

      <div className="mt-4 space-y-3">
        {jobs?.map((j) => {
          const done = Number(j.accepted_chunks);
          const total = Number(j.total_chunks);
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <Link key={j.id} href={`/jobs/${j.id}`} className="block panel p-4 hover:border-[var(--accent)] transition-colors">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{j.title}</span>
                <span className="num text-xs text-[var(--text-dim)]">{j.game} · {j.version_pin}</span>
              </div>
              <div className="mt-3"><Progress done={done} total={total} /></div>
              <div className="num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-dim)]">
                <span><span className="text-[var(--accent)]">{fmt(done)}</span>/{fmt(total)} chunks · {pct}%</span>
                <span>{fmt(j.chunk_size)} seeds/chunk</span>
                <span className="inline-flex gap-1">spec <Mono value={j.worker_spec_hash} head={8} tail={0} /></span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
