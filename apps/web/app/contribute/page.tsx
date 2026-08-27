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
            <div className="mt-1.5 h-1 w-full bg-[var(--panel-2)] overflow-hidden">
              <div className="h-full w-full bg-[var(--accent)] origin-left transition-transform duration-300"
                style={{ transform: `scaleX(${stats.chunkProgress ?? 0})` }} />
            </div>
          )}
        </div>
      )}

      <section className="mt-4 panel ticked flex flex-col">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">log</span>
          <span className="num text-[11px] text-[var(--text-faint)]">{(stats?.log ?? []).length} lines</span>
        </div>
        {/* fixed-height, scrollable terminal so it's a defined block, not empty void.
            The 26px ruled lines are a deliberate log-terminal texture (each row sits on
            a rule), not generic stripe decoration. */}
        {/* impeccable-disable-next-line repeating-stripes-gradient -- terminal row ruling */}
        <div className="h-[340px] overflow-y-auto scroll-thin"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, var(--panel-2) 0, var(--panel-2) 1px, transparent 1px, transparent 26px)", backgroundSize: "100% 26px" }}>
          {(stats?.log ?? []).length === 0 ? (
            <div className="h-full flex items-center justify-center text-center px-4">
              <div>
                <div className="num text-xs text-[var(--text-faint)]">— idle —</div>
                <div className="text-[12px] text-[var(--text-faint)] mt-1 max-w-[36ch]">
                  Pick a job and press Start sieving. Leased ranges, verifications, and accepted chunks stream here.
                </div>
              </div>
            </div>
          ) : (
            <ul className="num text-xs">
              {(stats?.log ?? []).map((line, i) => (
                <li key={i} className="px-4 h-[26px] flex items-center"
                  style={{ color: line.includes("accepted") ? "var(--verified)" : line.includes("rejected") ? "var(--rejected)" : "var(--text-dim)" }}>
                  <span className="text-[var(--text-faint)] mr-2">›</span>{line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
