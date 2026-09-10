"use client";

import { use, useEffect, useRef, useState } from "react";
import { SieveWorkerModule } from "@sieveworks/wasm-runtime";
import { signCandidate, walletFromSecretKey, type CandidateSubmission } from "@sieveworks/protocol";
import { COORDINATOR_URL, fetchJob, fetchJobCandidates, solStr, subscribeEvents, type JobDetail } from "@/lib/api";
import { Panel } from "@/components/console";
import { Badge, Button, Mono, Skeleton, fmt } from "@/components/ui";

/**
 * The training page: evolve a neural net IN YOUR BROWSER against the
 * bounty's fitness module, watch the best bird fly the course live, and
 * submit your champion — the coordinator re-verifies it in one call.
 * Evolution runs host-side (any strategy is legal — the bounty pays for
 * the RESULT); the module is only ever the deterministic scorer.
 */

const GENOME_LEN = 130;
const POP = 96;
const ELITE = 12;
const WORLD_H = 480;
const PIPE_SPACING = 220;
const PIPE_W = 52;
const PIPE_GAP = 150;
const BIRD_X = 120;
const PIPE_SPEED = 3;
const FIRST_PIPE_X = 400;

const WALLET_KEY = "sieveworks_worker_seed_v1"; // same identity as contribute

interface GenStat {
  gen: number;
  best: number;
}

export default function TrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [gen, setGen] = useState(0);
  const [best, setBest] = useState<bigint>(-1n);
  const [history, setHistory] = useState<GenStat[]>([]);
  const [leaderboard, setLeaderboard] = useState<{ verified_score: string; wallet_address: string; submitted_at: string }[]>([]);
  const [submitState, setSubmitState] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modRef = useRef<SieveWorkerModule | null>(null);
  const popRef = useRef<Uint8Array[]>([]);
  const bestGenomeRef = useRef<Uint8Array | null>(null);
  const runningRef = useRef(false);
  const replayRef = useRef<{ trace: DataView; tick: number } | null>(null);

  const refreshLeaderboard = () => {
    fetchJobCandidates(id).then((r) => setLeaderboard(r.candidates as never)).catch(() => {});
  };

  useEffect(() => {
    fetchJob(id).then(setDetail).catch(() => {});
    refreshLeaderboard();
    return subscribeEvents((_e, data) => {
      if ((data as { job_id?: string })?.job_id === id) refreshLeaderboard();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const paramsJson = detail ? JSON.stringify(detail.job.params) : "{}";

  async function ensureModule(): Promise<SieveWorkerModule> {
    if (modRef.current) return modRef.current;
    const hash = String(detail!.job.worker_spec_hash);
    const bytes = await (await fetch(`${COORDINATOR_URL}/v1/specs/${hash}/artifact`)).arrayBuffer();
    modRef.current = await SieveWorkerModule.load(new Uint8Array(bytes), hash);
    return modRef.current;
  }

  async function startEvolution(): Promise<void> {
    if (runningRef.current || !detail) return;
    runningRef.current = true;
    setRunning(true);
    const mod = await ensureModule();
    if (popRef.current.length === 0) {
      popRef.current = Array.from({ length: POP }, () =>
        Uint8Array.from({ length: GENOME_LEN }, () => (Math.random() * 256) | 0)
      );
    }
    let g = gen;
    const evolve = () => {
      if (!runningRef.current) return;
      const scored = popRef.current
        .map((gg) => ({ gg, s: mod.evaluateCandidate(gg, paramsJson) }))
        .sort((a, b) => (b.s > a.s ? 1 : b.s < a.s ? -1 : 0));
      const genBest = scored[0]!;
      if (genBest.s > best || bestGenomeRef.current === null) {
        bestGenomeRef.current = genBest.gg.slice();
        setBest(genBest.s);
        startReplay(mod, genBest.gg);
      }
      g += 1;
      setGen(g);
      setHistory((h) => [...h.slice(-199), { gen: g, best: Number(genBest.s) }]);
      const next = scored.slice(0, ELITE).map((x) => x.gg);
      while (next.length < POP) {
        const parent = scored[(Math.random() * ELITE * 2) | 0]!.gg;
        const child = parent.slice();
        for (let i = 0; i < GENOME_LEN; i++) {
          if (Math.random() < 0.08) child[i] = (child[i]! + ((Math.random() * 64) | 0) - 32) & 0xff;
        }
        next.push(child);
      }
      popRef.current = next;
      // One generation per frame-ish — deliberately paced so the learning
      // is WATCHABLE (the raw loop would master the course in a second).
      setTimeout(evolve, 120);
    };
    evolve();
  }

  function stopEvolution(): void {
    runningRef.current = false;
    setRunning(false);
  }

  function startReplay(mod: SieveWorkerModule, genome: Uint8Array): void {
    try {
      const trace = mod.traceCandidate(genome, paramsJson);
      replayRef.current = { trace: new DataView(trace.buffer, trace.byteOffset, trace.byteLength), tick: 0 };
    } catch {
      replayRef.current = null;
    }
  }

  // Canvas replay loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const rep = replayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, 0, W, H);
      if (!rep) {
        ctx.fillStyle = "#6b6b70";
        ctx.font = "13px monospace";
        ctx.fillText("start evolution to see the best bird fly", 24, H / 2);
        return;
      }
      const dv = rep.trace;
      const nTicks = dv.getUint32(0, true);
      const nPipes = dv.getUint32(8, true);
      if (nTicks === 0) return;
      const t = rep.tick % nTicks;
      const yOff = 12 + nPipes * 4 + t * 4;
      if (yOff + 2 > dv.byteLength) { rep.tick = 0; return; }
      const birdY = dv.getInt16(yOff, true) * (H / WORLD_H);
      const scroll = t * PIPE_SPEED;
      // pipes
      ctx.fillStyle = "#3a3325";
      for (let i = 0; i < nPipes; i++) {
        const px = FIRST_PIPE_X + i * PIPE_SPACING - scroll;
        if (px + PIPE_W < 0 || px > W) continue;
        const gc = dv.getInt32(12 + i * 4, true) * (H / WORLD_H);
        const gap = (PIPE_GAP * H) / WORLD_H / 2;
        ctx.fillRect(px, 0, PIPE_W, gc - gap);
        ctx.fillRect(px, gc + gap, PIPE_W, H - gc - gap);
      }
      // bird
      ctx.fillStyle = "#e0b64a";
      ctx.beginPath();
      ctx.arc(BIRD_X, birdY, 8, 0, Math.PI * 2);
      ctx.fill();
      rep.tick += 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function submitBest(): Promise<void> {
    if (!bestGenomeRef.current || !detail) return;
    setSubmitState("submitting…");
    const stored = localStorage.getItem(WALLET_KEY);
    const seed = stored
      ? Uint8Array.from(JSON.parse(stored) as number[])
      : crypto.getRandomValues(new Uint8Array(32));
    if (!stored) localStorage.setItem(WALLET_KEY, JSON.stringify(Array.from(seed)));
    const wallet = walletFromSecretKey(seed);
    const unsigned: Omit<CandidateSubmission, "signature"> = {
      job_id: id,
      candidate_b64: btoa(String.fromCharCode(...bestGenomeRef.current)),
      claimed_score: best.toString(),
      nonce: Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""),
      wallet_address: wallet,
    };
    const submission = { ...unsigned, signature: signCandidate(unsigned, seed) };
    const res = await fetch(`${COORDINATOR_URL}/v1/candidates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
    const body = (await res.json().catch(() => ({}))) as { verified_score?: string; state?: string; error?: unknown };
    if (res.ok && body.state === "verified") {
      setSubmitState(`verified at ${body.verified_score} ✓`);
      refreshLeaderboard();
    } else {
      setSubmitState(`submission ${body.state ?? "failed"} (${res.status})`);
    }
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-5xl space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isPrize = String(detail.job.bounty_kind ?? "") === "prize";
  const deadline = detail.job.deadline_at ? new Date(String(detail.job.deadline_at)) : null;
  const maxHist = Math.max(1, ...history.map((h) => h.best));

  return (
    <div className="mx-auto max-w-[1200px] space-y-3">
      <div className="panel ticked px-4 py-4">
        <h1 className="font-display text-xl font-bold tracking-tight">{String(detail.job.title)}</h1>
        <p className="num mt-1 text-xs text-[var(--text-dim)] flex flex-wrap gap-x-3">
          <span>prize bounty · train in your browser · best verified genome wins</span>
          <span className="inline-flex gap-1">spec <Mono value={String(detail.job.worker_spec_hash)} head={10} tail={0} /></span>
          <Badge state={String(detail.job.status)} />
        </p>
        {isPrize && (
          <p className="num mt-2 text-xs flex flex-wrap gap-x-4">
            <span>prize <span className="text-[var(--accent)]">◎{solStr(String(detail.job.prize_lamports ?? "0"))}</span></span>
            <span className="text-[var(--text-dim)]">threshold {String(detail.job.threshold_score ?? "—")}</span>
            {deadline && <span className="text-[var(--text-dim)]">deadline {deadline.toLocaleString()}</span>}
          </p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Panel label="◢ best bird, live replay" right={best >= 0n ? `fitness ${best}` : "—"}>
          <canvas ref={canvasRef} width={720} height={420} style={{ width: "100%", background: "#0a0a0c" }} />
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {!running ? (
              <Button variant="primary" onClick={() => void startEvolution()}>▶ {gen === 0 ? "Start evolution" : "Resume"}</Button>
            ) : (
              <Button onClick={stopEvolution}>⏸ Pause</Button>
            )}
            <Button disabled={best < 0n} onClick={() => void submitBest()}>⬆ Submit best genome</Button>
            <span className="num text-xs text-[var(--text-dim)]">gen <span className="text-[var(--accent)]">{gen}</span> · pop {POP}</span>
            {submitState && <span className="num text-xs text-[var(--text-dim)]">{submitState}</span>}
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel label="◇ fitness over generations">
            <div className="h-32 flex items-end gap-[1px]">
              {history.slice(-80).map((h) => (
                <div key={h.gen} className="flex-1 bg-[var(--accent)] opacity-80" style={{ height: `${Math.max(2, (h.best / maxHist) * 100)}%` }} />
              ))}
              {history.length === 0 && <span className="text-xs text-[var(--text-faint)]">no generations yet</span>}
            </div>
            <p className="num mt-1 text-[11px] text-[var(--text-faint)]">fitness = pipes × 10000 + ticks survived</p>
          </Panel>

          <Panel label="◆ verified leaderboard" right={`${leaderboard.length}`}>
            <table className="num w-full text-left text-xs">
              <tbody>
                {leaderboard.slice(0, 8).map((c, i) => (
                  <tr key={i} className="border-b border-[var(--border)]">
                    <td className="py-1 pr-2 text-[var(--text-faint)]">{i + 1}</td>
                    <td className="py-1 pr-2 text-[var(--verified)]">{c.verified_score}</td>
                    <td className="py-1"><Mono value={c.wallet_address} kind="address" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leaderboard.length === 0 && <p className="text-xs text-[var(--text-faint)]">no verified submissions yet — be first</p>}
            <p className="mt-2 text-[11px] text-[var(--text-faint)]">
              Scores are public; genome bytes stay sealed until the bounty
              closes. Every score you see was re-verified by the coordinator.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
