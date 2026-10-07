"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchJobs, solStr, subscribeEvents, type JobSummary } from "@/lib/api";
import { Button, Progress, Skeleton, fmt } from "@/components/ui";
import { PageShell } from "@/components/PageShell";

/** Reads the bounty kind from its module so the board isn't a wall of identical rows. */
function kindOf(game: string): { label: string; color: string } {
  const g = (game || "").toLowerCase();
  if (g.includes("flappy") || g.includes("train") || g.includes("neuro")) return { label: "Training", color: "var(--amber)" };
  if (g.includes("mandel") || g.includes("render")) return { label: "Render", color: "var(--amber)" };
  if (g.includes("hash") || g.includes("grind")) return { label: "Proof-of-work", color: "var(--accent)" };
  return { label: "Search", color: "var(--accent)" };
}

function Row({ j }: { j: JobSummary }) {
  const done = Number(j.accepted_chunks);
  const total = Number(j.total_chunks);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const kind = kindOf(j.game);
  const priced = Number(j.price_per_chunk_lamports) > 0;

  return (
    <Link href={`/bounties/${j.id}`} className="block panel p-4 sm:p-5 hover:border-[var(--accent)] transition-colors">
      <div className="grid grid-cols-[1fr_auto] gap-4 sm:gap-5 items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-faint)]">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: kind.color }} />
              {kind.label}
            </span>
            <span className="font-display font-bold text-[16px] truncate">{j.title}</span>
          </div>
          <div className="mt-2.5 max-w-[340px]"><Progress done={done} total={total} /></div>
          <div className="num mt-2 text-[12px] text-[var(--text-faint)]">{pct}% searched · {fmt(done)}/{fmt(total)} chunks</div>
        </div>
        <div className="text-right border-l border-[var(--border)] pl-4 sm:pl-5 shrink-0">
          {priced ? (
            <>
              <div className="num font-display font-bold text-[18px]">{solStr(j.price_per_chunk_lamports)}</div>
              <div className="text-[11px] text-[var(--text-faint)]">SOL / chunk</div>
            </>
          ) : (
            <div className="text-[14px] font-semibold text-[var(--text-dim)]">Free</div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Jobs() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    const refresh = () => fetchJobs().then((r) => setJobs(r.jobs)).catch(() => setJobs([]));
    refresh();
    return subscribeEvents(refresh, ["chunk_accepted", "job_created", "chunk_leased", "chunk_rejected"]);
  }, []);

  return (
    <PageShell>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-[clamp(26px,3.6vw,36px)] font-bold tracking-[-0.028em]">Bounty board</h1>
        <Button href="/bounties/new" variant="ghost">Post a bounty</Button>
      </div>

      {jobs === null && <div className="mt-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>}
      {jobs?.length === 0 && <p className="mt-6 text-sm text-[var(--text-dim)]">No open bounties yet.</p>}

      <div className="mt-6 space-y-3">
        {jobs?.map((j) => <Row key={j.id} j={j} />)}
      </div>
    </PageShell>
  );
}
