"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFinds, subscribeEvents, type Find } from "@/lib/api";
import { Mono, Skeleton } from "@/components/ui";

export default function Finds() {
  const [finds, setFinds] = useState<Find[] | null>(null);
  useEffect(() => {
    const refresh = () => fetchFinds().then((r) => setFinds(r.finds)).catch(() => setFinds([]));
    refresh();
    return subscribeEvents(refresh, ["new_record", "chunk_accepted"]);
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-xl font-bold tracking-tight">Verified finds</h1>
      <p className="mt-1 text-sm text-[var(--text-dim)]">
        Every discovery, deterministically re-verified and attributed. Records are written on-chain.
      </p>
      {finds === null && <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
      {finds?.length === 0 && <p className="mt-4 text-sm text-[var(--text-faint)]">No verified finds yet.</p>}
      <div className="mt-4 panel divide-y divide-[var(--border)]">
        {finds?.map((f) => (
          <div key={f.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            {f.is_record && <span className="num text-[10px] px-1.5 py-0.5 border border-[var(--accent)] text-[var(--accent)]">RECORD</span>}
            <span className="num">score <span className="text-[var(--verified)]">{f.score}</span></span>
            <span className="num text-[var(--text-dim)]">seed {f.seed}</span>
            <Link href={`/bounties/${f.job_id}`} className="text-[var(--text-dim)] hover:text-[var(--text)]">{f.job_title}</Link>
            <span className="num text-xs text-[var(--text-dim)] inline-flex gap-1 ml-auto">
              by <Mono value={f.wallet_address} kind="address" />
              {f.tx_signature ? <> · <Mono value={f.tx_signature} kind="tx" /></> : <span className="text-[var(--text-faint)]">· off-chain</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
