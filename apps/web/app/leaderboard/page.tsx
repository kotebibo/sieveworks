"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchLeaderboard, solStr, subscribeEvents, type Leader } from "@/lib/api";
import { Mono, Skeleton, fmt } from "@/components/ui";

export default function Leaderboard() {
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  useEffect(() => {
    const refresh = () => fetchLeaderboard().then((r) => setLeaders(r.leaders)).catch(() => setLeaders([]));
    refresh();
    return subscribeEvents(refresh, ["chunk_accepted"]);
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold">Leaderboard</h1>
      <p className="mt-1 text-sm text-[var(--text-dim)]">Contributors ranked by verified chunks.</p>
      {leaders === null && <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
      {leaders?.length === 0 && <p className="mt-4 text-sm text-[var(--text-faint)]">No contributors yet.</p>}
      {leaders && leaders.length > 0 && (
        <div className="mt-4 panel overflow-x-auto">
          <table className="num w-full text-left text-sm">
            <thead className="text-[var(--text-faint)] text-xs">
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-2 font-normal">#</th>
                <th className="px-4 py-2 font-normal">contributor</th>
                <th className="px-4 py-2 font-normal text-right">chunks</th>
                <th className="px-4 py-2 font-normal text-right">finds</th>
                <th className="px-4 py-2 font-normal text-right">earned (SOL)</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((l, i) => (
                <tr key={l.wallet_address} className="border-b border-[var(--border)]">
                  <td className="px-4 py-2 text-[var(--text-faint)]">{i + 1}</td>
                  <td className="px-4 py-2">
                    <Link href={`/workers/${l.wallet_address}`} className="hover:text-[var(--accent)]">
                      <Mono value={l.wallet_address} kind="address" head={6} tail={6} />
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--accent)]">{fmt(l.chunks)}</td>
                  <td className="px-4 py-2 text-right">{fmt(l.finds)}</td>
                  <td className="px-4 py-2 text-right text-[var(--text-dim)]">{solStr(l.earned_lamports)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
