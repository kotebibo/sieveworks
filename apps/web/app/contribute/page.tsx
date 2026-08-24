"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJobs, truncate, type JobSummary } from "@/lib/api";
import { ContributeEngine, type EngineStats } from "@/lib/worker/engine";

export default function Contribute() {
  const engineRef = useRef<ContributeEngine | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobId, setJobId] = useState<string>("");
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

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-semibold">Contribute</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Your browser evaluates seeds in sandboxed WebAssembly. Nothing is installed. A local
        worker wallet is created for you; keys never leave this page.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <label className="text-xs text-[var(--muted)]">
          job
          <select
            className="mt-1 block border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)] appearance-none"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            disabled={running}
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} ({j.pending_chunks} chunks left)
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          threads: <span className="num">{threads}</span>/{maxThreads}
          <input
            type="range" min={1} max={maxThreads} value={threads}
            onChange={(e) => setThreads(Number(e.target.value))}
            disabled={running}
            className="mt-2 block w-40 accent-[var(--accent)]"
          />
        </label>
        {!running ? (
          <button
            onClick={() => jobId && engineRef.current?.start(jobId, threads)}
            disabled={!jobId}
            className="border border-[var(--accent)] px-5 py-2 text-sm text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--background)] disabled:opacity-40"
          >
            ▶ Start sieving
          </button>
        ) : (
          <button
            onClick={() => engineRef.current?.stop()}
            className="border border-[var(--rejected)] px-5 py-2 text-sm text-[var(--rejected)] hover:bg-[var(--rejected)] hover:text-[var(--background)]"
          >
            ■ Stop
          </button>
        )}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["status", stats?.status ?? "idle"],
          ["seeds/sec", stats ? stats.seedsPerSec.toLocaleString("en-US") : "0"],
          ["session seeds", stats ? stats.sessionSeeds.toLocaleString("en-US") : "0"],
          ["chunks done", stats ? String(stats.sessionChunks) : "0"],
        ].map(([label, value]) => (
          <div key={label} className="border border-[var(--border)] p-3">
            <dt className="text-xs text-[var(--muted)]">{label}</dt>
            <dd className="num mt-1 text-xl">{value}</dd>
          </div>
        ))}
      </dl>

      {stats?.wallet && (
        <p className="num mt-3 text-xs text-[var(--muted)]">
          worker wallet {truncate(stats.wallet, 8, 8)}
          {stats.currentChunk && <> · working on {truncate(stats.currentChunk, 8, 0)}</>}
        </p>
      )}

      <section className="mt-6">
        <h2 className="text-xs uppercase tracking-wider text-[var(--muted)]">log</h2>
        <ul className="num mt-2 space-y-1 text-xs text-[var(--muted)]">
          {(stats?.log ?? []).map((line, i) => (
            <li key={i} className={line.includes("accepted") ? "text-[var(--verified)]" : undefined}>
              {line}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
