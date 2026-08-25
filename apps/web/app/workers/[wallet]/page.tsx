"use client";

import { use, useEffect, useState } from "react";
import { fetchWorker, solStr } from "@/lib/api";
import { Mono, Skeleton, Stat, fmt } from "@/components/ui";

export default function WorkerProfile({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = use(params);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchWorker>> | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchWorker(wallet).then(setData).catch(() => setNotFound(true));
  }, [wallet]);

  if (notFound) return <p className="mx-auto max-w-4xl text-sm text-[var(--text-dim)]">Contributor not found.</p>;
  if (!data) return <div className="mx-auto max-w-4xl space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-24 w-full" /></div>;

  const s = data.stats;
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold">Contributor</h1>
      <p className="mt-1"><Mono value={data.worker.wallet_address} kind="address" head={8} tail={8} /></p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="chunks verified" value={fmt(s.chunks as number)} accent />
        <Stat label="seeds evaluated" value={fmt(s.seeds as string)} />
        <Stat label="finds" value={fmt(s.finds as number)} />
        <Stat label="earned (SOL)" value={solStr(s.earned as string)} />
      </dl>

      {(s.rejected as number) > 0 && (
        <p className="num mt-2 text-xs text-[var(--rejected)]">{fmt(s.rejected as number)} rejected submissions</p>
      )}

      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">finds attributed</h2>
        {data.finds.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-faint)]">none yet</p>
        ) : (
          <div className="mt-2 panel divide-y divide-[var(--border)]">
            {(data.finds as { seed: string; score: string; is_record: boolean; created_at: string }[]).map((f, i) => (
              <div key={i} className="px-4 py-2 num text-sm flex gap-4">
                {f.is_record && <span className="text-[10px] px-1.5 py-0.5 border border-[var(--accent)] text-[var(--accent)]">RECORD</span>}
                <span>score <span className="text-[var(--verified)]">{f.score}</span></span>
                <span className="text-[var(--text-dim)]">seed {f.seed}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
