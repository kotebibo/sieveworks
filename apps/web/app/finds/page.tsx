"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchFinds, subscribeEvents, type Find } from "@/lib/api";
import { Mono, Skeleton } from "@/components/ui";
import { PageShell } from "@/components/PageShell";

export default function Finds() {
  const [finds, setFinds] = useState<Find[] | null>(null);
  useEffect(() => {
    const refresh = () => fetchFinds().then((r) => setFinds(r.finds)).catch(() => setFinds([]));
    refresh();
    return subscribeEvents(refresh, ["new_record", "chunk_accepted"]);
  }, []);

  return (
    <PageShell max="max-w-4xl">
      <h1 className="font-display text-[clamp(26px,3.6vw,36px)] font-bold tracking-[-0.028em]">Verified finds</h1>
      <p className="mt-2 text-[15px] text-[var(--text-dim)] max-w-[62ch]">
        Every discovery, deterministically re-verified and attributed. Priced bounties attest each find on Solana, with a transaction you can open in the explorer.
      </p>
      {finds === null && <div className="mt-6 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
      {finds?.length === 0 && <p className="mt-6 text-sm text-[var(--text-faint)]">No verified finds yet.</p>}
      <div className="mt-6 panel divide-y divide-[var(--border)]">
        {finds?.map((f) => (
          <div key={f.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-2 shrink-0">
              {f.is_record && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--verified)" }} title="record" />}
              <span className="num">score <span className="text-[var(--verified)] font-semibold">{f.score}</span></span>
            </span>
            <span className="num text-[var(--text-dim)]">seed {f.seed}</span>
            <Link href={`/bounties/${f.job_id}`} className="text-[var(--text-dim)] hover:text-[var(--text)] truncate max-w-[22ch]">{f.job_title}</Link>
            <span className="num text-xs text-[var(--text-dim)] inline-flex items-center gap-1 ml-auto">
              by <Mono value={f.wallet_address} kind="address" />
              {f.tx_signature && <> · <Mono value={f.tx_signature} kind="tx" /></>}
            </span>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
