"use client";

import { useEffect, useRef, useState } from "react";
import { fetchStats, subscribeEvents, type GlobalStats } from "@/lib/api";
import { Button, LiveNum, Mono, Stat } from "@/components/ui";

interface Activity {
  at: string;
  text: string;
  good: boolean;
  key: string;
}

export default function Home() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
    return subscribeEvents((event, data) => {
      const d = (data ?? {}) as Record<string, string>;
      let text = event.replace(/_/g, " ");
      let good = false;
      if (event === "chunk_accepted") {
        text = `verified · score ${d.extremum_score} · seed ${d.witness_seed}`;
        good = true;
      } else if (event === "new_record") {
        text = `NEW RECORD · score ${d.score} · seed ${d.seed}`;
        good = true;
      } else if (event === "chunk_rejected") {
        text = `rejected`;
      } else if (event === "chunk_leased") {
        text = `chunk leased`;
      }
      setActivity((a) =>
        [{ at: new Date().toISOString().slice(11, 19), text, good, key: `${Date.now()}-${Math.random()}` }, ...a].slice(0, 14)
      );
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fetchStats().then(setStats).catch(() => {}), 400);
    });
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <section className="grid-bg panel p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight max-w-2xl">
          An exchange for verifiable search
        </h1>
        <p className="mt-3 text-[var(--text-dim)] max-w-xl text-sm leading-relaxed">
          Fund a brute-force search. Contributors run chunks on their own hardware and get paid per
          verified chunk on Solana. Every discovery is permanently attributed on-chain — hard to
          find, easy to check.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="/contribute" variant="primary">▶ Start contributing</Button>
          <Button href="/jobs" variant="ghost">Browse bounties</Button>
        </div>
      </section>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="contributors" value={stats ? String(stats.contributors) : "—"} />
        <Stat label="chunks verified" value={stats ? String(stats.chunks_accepted) : "—"} accent />
        <Stat label="seeds evaluated" value={stats ? Number(stats.seeds_evaluated).toLocaleString("en-US") : "—"} />
        <Stat label="in flight" value={stats ? String(stats.chunks_in_flight) : "—"} />
      </dl>

      <section className="mt-4 panel">
        <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--text-dim)] flex justify-between">
          <span>live activity</span>
          <span className="num">{stats ? `${stats.sse_clients} watching` : ""}</span>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {activity.length === 0 && (
            <li className="px-4 py-3 text-xs text-[var(--text-faint)]">quiet — waiting for the swarm</li>
          )}
          {activity.map((a) => (
            <li
              key={a.key}
              className={`px-4 py-2 text-xs num flex gap-3 ${a.good ? "flash-good" : "flash"}`}
              style={{ color: a.good ? "var(--verified)" : "var(--text-dim)" }}
            >
              <span className="text-[var(--text-faint)]">{a.at}</span>
              <span>{a.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
