"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchFinds, fetchStats, fetchSwarm, subscribeEvents, type Find, type GlobalStats } from "@/lib/api";
import { KpiStrip, Panel, Readout, SwarmGrid } from "@/components/console";
import { Button, Mono } from "@/components/ui";

interface Activity { at: string; text: string; good: boolean; bad: boolean; key: string }

export default function Home() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [swarm, setSwarm] = useState<{ job_id: string | null; title: string | null; cells: string }>({ job_id: null, title: null, cells: "" });
  const [finds, setFinds] = useState<Find[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      fetchStats().then(setStats).catch(() => {});
      fetchSwarm().then(setSwarm).catch(() => {});
      fetchFinds().then((r) => setFinds(r.finds.slice(0, 8))).catch(() => {});
    };
    refresh();
    return subscribeEvents((event, data) => {
      const d = (data ?? {}) as Record<string, string>;
      let text = event.replace(/_/g, " ");
      let good = false, bad = false;
      if (event === "chunk_accepted") { text = `VERIFIED  score ${d.extremum_score}  seed ${d.witness_seed}`; good = true; }
      else if (event === "new_record") { text = `◆ NEW RECORD  score ${d.score}  seed ${d.seed}`; good = true; }
      else if (event === "chunk_rejected") { text = `REJECTED  slash pending`; bad = true; }
      else if (event === "chunk_leased") { text = `lease issued`; }
      else if (event === "chunk_challenged") { text = `challenge issued  8 buckets`; }
      setActivity((a) => [{ at: new Date().toISOString().slice(11, 19), text, good, bad, key: `${Date.now()}-${Math.random()}` }, ...a].slice(0, 22));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 350);
    });
  }, []);

  return (
    <div className="mx-auto max-w-[1400px] space-y-3">
      {/* headline band */}
      <div className="panel ticked grid-bg px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight leading-tight max-w-2xl">
            AN EXCHANGE FOR VERIFIABLE SEARCH
          </h1>
          <p className="mt-2 text-[13px] text-[var(--text-dim)] max-w-xl leading-relaxed">
            Fund a brute-force search · contributors run it on their own hardware · paid per verified
            chunk on Solana · every discovery attributed on-chain. Hard to find, easy to check.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button href="/contribute" variant="primary">▶ CONTRIBUTE</Button>
          <Button href="/jobs" variant="ghost">BOUNTIES</Button>
        </div>
      </div>

      <KpiStrip
        items={[
          { label: "contributors", value: stats ? String(stats.contributors) : "—" },
          { label: "chunks verified", value: stats ? Number(stats.chunks_accepted).toLocaleString("en-US") : "—", accent: true },
          { label: "seeds evaluated", value: stats ? Number(stats.seeds_evaluated).toLocaleString("en-US") : "—" },
          { label: "in flight", value: stats ? String(stats.chunks_in_flight) : "—" },
        ]}
      />

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        {/* SWARM — the hero */}
        <Panel
          label="◢ live swarm"
          right={swarm.title ? swarm.title.toUpperCase() : "no active job"}
          bodyClass="p-3"
        >
          {swarm.job_id ? (
            <Link href={`/jobs/${swarm.job_id}`} className="block">
              <SwarmGrid cells={swarm.cells} />
            </Link>
          ) : (
            <div className="h-48 flex items-center justify-center text-xs text-[var(--text-faint)]">awaiting a bounty</div>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] barlabel">
            <Legend c="var(--verified)" t="verified" />
            <Legend c="var(--accent)" t="leased" />
            <Legend c="var(--amber)" t="verifying" />
            <Legend c="var(--rejected)" t="rejected" />
            <Legend c="var(--panel-2)" t="pending" />
          </div>
        </Panel>

        {/* event stream */}
        <Panel label="stream //" right={stats ? `${stats.sse_clients} online` : ""} bodyClass="p-0">
          <ul className="num text-[11px] divide-y divide-[var(--border)] max-h-[340px] overflow-y-auto scroll-thin">
            {activity.length === 0 && <li className="px-3 py-3 text-[var(--text-faint)]">idle — waiting for the swarm</li>}
            {activity.map((a) => (
              <li key={a.key} className={`px-3 py-1.5 flex gap-2 ${a.good ? "flash-good" : a.bad ? "flash" : ""}`}
                style={{ color: a.good ? "var(--verified)" : a.bad ? "var(--rejected)" : "var(--text-dim)" }}>
                <span className="text-[var(--text-faint)] shrink-0">{a.at}</span>
                <span className="truncate">{a.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* finds ticker */}
      <Panel label="◆ recent finds" right="deterministically verified" bodyClass="p-0">
        <div className="overflow-x-auto scroll-thin">
          <table className="num w-full text-[11px] whitespace-nowrap">
            <tbody className="divide-y divide-[var(--border)]">
              {finds.length === 0 && <tr><td className="px-3 py-3 text-[var(--text-faint)]">no verified finds yet</td></tr>}
              {finds.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-1.5 w-14">{f.is_record && <span className="text-[var(--accent)]">◆ REC</span>}</td>
                  <td className="px-3 py-1.5" style={{ color: "var(--verified)" }}>score {f.score}</td>
                  <td className="px-3 py-1.5 text-[var(--text-dim)]">seed {f.seed}</td>
                  <td className="px-3 py-1.5 text-[var(--text-dim)]">{f.job_title}</td>
                  <td className="px-3 py-1.5"><Mono value={f.wallet_address} kind="address" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 inline-block" style={{ backgroundColor: c }} /> {t}
    </span>
  );
}
