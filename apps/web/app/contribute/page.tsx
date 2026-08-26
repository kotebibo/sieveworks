"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { fetchJobs, type JobSummary } from "@/lib/api";
import { ContributeEngine, type EngineStats } from "@/lib/worker/engine";
import { Badge, Button, LiveNum, Mono, Stat, fmt } from "@/components/ui";
import { WalletButton } from "@/lib/wallet";

export default function Contribute() {
  const engineRef = useRef<ContributeEngine | null>(null);
  const { publicKey, connected } = useWallet();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobId, setJobId] = useState("");
  const [threads, setThreads] = useState(1);
  const [maxThreads, setMaxThreads] = useState(1);
  const [stats, setStats] = useState<EngineStats | null>(null);

  useEffect(() => {
    const max = Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
    setMaxThreads(max);
    setThreads(max);
    fetchJobs().then((r) => {
      const open = r.jobs.filter((j) => Number(j.pending_chunks) > 0);
      setJobs(open);
      if (open[0]) setJobId(open[0].id);
    });
    engineRef.current = new ContributeEngine();
    engineRef.current.subscribe(setStats);
    return () => engineRef.current?.stop();
  }, []);

  const running = stats?.status === "running" || stats?.status === "starting";
  const payoutAddress = connected && publicKey ? publicKey.toBase58() : undefined;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-xl font-bold tracking-tight">CONTRIBUTE</h1>
      <p className="mt-1 text-sm text-[var(--text-dim)] max-w-2xl">
        Your browser evaluates seeds in sandboxed WebAssembly. Nothing is installed, no signup. A
        local worker key is created for you automatically — connect a wallet only when you want
        earnings paid to an address you control.
      </p>

      <div className="mt-5 panel ticked p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-[var(--text-dim)] w-full sm:w-auto min-w-0">
            job
            <select
              className="num mt-1 block w-full sm:w-auto sm:min-w-64 max-w-full border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)] appearance-none"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              disabled={running}
            >
              {jobs.length === 0 && <option>no open jobs</option>}
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.title} · {fmt(j.pending_chunks)} left</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--text-dim)]">
            threads <span className="num text-[var(--text)]">{threads}</span> / {maxThreads}
            <input
              type="range" min={1} max={maxThreads} value={threads}
              onChange={(e) => setThreads(Number(e.target.value))}
              disabled={running}
              className="mt-2 block w-44 accent-[var(--accent)]"
            />
          </label>
          {!running ? (
            <Button variant="primary" disabled={!jobId || jobs.length === 0}
              onClick={() => jobId && engineRef.current?.start(jobId, threads, payoutAddress)}>
              ▶ Start sieving
            </Button>
          ) : (
            <Button variant="danger" onClick={() => engineRef.current?.stop()}>■ Stop</Button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-dim)]">
          <span>payout:</span>
          {payoutAddress ? (
            <span className="inline-flex items-center gap-1 text-[var(--verified)]">
              <Mono value={payoutAddress} kind="address" /> connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              earnings held to local key · <WalletButton /> to claim to your wallet
            </span>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="status" value={stats?.status ?? "idle"} />
        <Stat label="seeds/sec" value={stats ? String(stats.seedsPerSec) : "0"} accent />
        <Stat label="session seeds" value={stats ? String(stats.sessionSeeds) : "0"} />
        <Stat label="chunks done" value={stats ? String(stats.sessionChunks) : "0"} />
      </dl>

      {stats?.wallet && (
        <div className="mt-3">
          <p className="num text-xs text-[var(--text-dim)] flex flex-wrap gap-x-3">
            <span className="inline-flex gap-1">worker key <Mono value={stats.wallet} kind="address" /></span>
            {stats.currentChunk && <span>· working on {stats.currentChunk.slice(0, 8)}…</span>}
          </p>
          {running && stats.currentChunk && (
            <div className="mt-1.5 h-1 w-full bg-[var(--panel-2)]">
              <div className="h-full bg-[var(--accent)] transition-[width] duration-300"
                style={{ width: `${Math.round((stats.chunkProgress ?? 0) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      <section className="mt-4 panel">
        <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--text-dim)]">log</div>
        <ul className="num divide-y divide-[var(--border)] text-xs">
          {(stats?.log ?? []).length === 0 && <li className="px-4 py-3 text-[var(--text-faint)]">idle</li>}
          {(stats?.log ?? []).map((line, i) => (
            <li key={i} className="px-4 py-1.5" style={{ color: line.includes("accepted") ? "var(--verified)" : line.includes("rejected") ? "var(--rejected)" : "var(--text-dim)" }}>
              {line}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
