"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchStats, subscribeEvents, truncate, type GlobalStats } from "@/lib/api";

interface Activity {
  at: string;
  text: string;
  kind: string;
}

export default function Home() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
    const unsubscribe = subscribeEvents((event, data) => {
      const d = (data ?? {}) as Record<string, string>;
      const label =
        event === "chunk_accepted"
          ? `chunk verified · score ${d.extremum_score} · seed ${d.witness_seed}`
          : event === "chunk_leased"
            ? `chunk leased → ${truncate(d.wallet ?? "?")}`
            : event.replace("_", " ");
      setActivity((a) => [{ at: new Date().toISOString(), text: label, kind: event }, ...a].slice(0, 12));
      // debounce a stats refresh behind bursts of events
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => fetchStats().then(setStats).catch(() => {}), 400);
    });
    return unsubscribe;
  }, []);

  const tiles: [string, string][] = [
    ["contributors", stats ? String(stats.contributors) : "—"],
    ["chunks verified", stats ? String(stats.chunks_accepted) : "—"],
    ["seeds evaluated", stats ? Number(stats.seeds_evaluated).toLocaleString("en-US") : "—"],
    ["chunks in flight", stats ? String(stats.chunks_in_flight) : "—"],
  ];

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">An exchange for verifiable search</h1>
      <p className="mt-2 text-[var(--muted)] max-w-xl text-sm">
        Fund a brute-force search. Contributors run chunks on their own hardware and get paid per
        verified chunk on Solana. Every discovery is permanently attributed on-chain.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="border border-[var(--border)] p-3">
            <dt className="text-xs text-[var(--muted)]">{label}</dt>
            <dd className="num mt-1 text-xl">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex gap-3">
        <Link href="/contribute" className="border border-[var(--accent)] text-[var(--accent)] px-4 py-2 text-sm hover:bg-[var(--accent)] hover:text-[var(--background)]">
          Start contributing →
        </Link>
        <Link href="/jobs" className="border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          Browse bounties
        </Link>
      </div>

      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-wider text-[var(--muted)]">live activity</h2>
        <ul className="num mt-2 space-y-1 text-xs">
          {activity.length === 0 && <li className="text-[var(--muted)]">quiet — waiting for events</li>}
          {activity.map((a, i) => (
            <li key={`${a.at}-${i}`} className={a.kind === "chunk_accepted" ? "text-[var(--verified)]" : "text-[var(--muted)]"}>
              <span className="opacity-60">{a.at.slice(11, 19)}</span> {a.text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
