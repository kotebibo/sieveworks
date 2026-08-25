"use client";

import { type BucketLeaf, hashLeaf, merkleProof, merkleRoot, toHex } from "@sieveworks/merkle";
import {
  ChunkAssignment,
  signResult,
  SubmissionResponse,
  walletFromSecretKey,
  type UnsignedResult,
} from "@sieveworks/protocol";
import { COORDINATOR_URL } from "@/lib/api";

/**
 * Host-side engine for the browser worker. Owns the keypair and all signing
 * (trust model: worker threads are pure compute and never see keys), leases
 * chunks, fans buckets out across the thread pool, commits, signs, submits.
 */

export interface EngineStats {
  status: string;
  wallet: string;
  threads: number;
  seedsPerSec: number;
  sessionSeeds: number;
  sessionChunks: number;
  currentChunk: string | null;
  chunkProgress: number; // 0..1 of the current chunk — keeps the ~25s wait alive
  log: string[];
}

type Listener = (s: EngineStats) => void;

const WALLET_KEY = "sieveworks_worker_seed_v1";

function loadOrCreateSeed(): Uint8Array {
  const existing = localStorage.getItem(WALLET_KEY);
  if (existing) return Uint8Array.from(JSON.parse(existing) as number[]);
  const seed = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(WALLET_KEY, JSON.stringify(Array.from(seed)));
  return seed;
}

export class ContributeEngine {
  private workers: Worker[] = [];
  private seed!: Uint8Array;
  wallet = "";
  private running = false;
  private stats: EngineStats = {
    status: "idle",
    wallet: "",
    threads: 0,
    seedsPerSec: 0,
    sessionSeeds: 0,
    sessionChunks: 0,
    currentChunk: null,
    chunkProgress: 0,
    log: [],
  };
  private listener: Listener | null = null;
  private recentProgress: { at: number; seeds: number }[] = [];
  private retained = new Map<string, BucketLeaf[]>();
  private chunkSeedsTotal = 1;
  private chunkSeedsDone = 0;

  subscribe(listener: Listener): void {
    this.listener = listener;
    this.emit();
  }

  private emit(patch: Partial<EngineStats> = {}): void {
    this.stats = { ...this.stats, ...patch };
    this.listener?.(this.stats);
  }

  private logLine(text: string): void {
    this.emit({ log: [`${new Date().toISOString().slice(11, 19)} ${text}`, ...this.stats.log].slice(0, 30) });
  }

  private payoutAddress: string | undefined;

  async start(jobId: string, threads: number, payoutAddress?: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.payoutAddress = payoutAddress;
    this.seed = loadOrCreateSeed();
    this.wallet = walletFromSecretKey(this.seed);
    this.emit({ status: "starting", wallet: this.wallet, threads });

    // One wasm fetch; each thread gets its own copy + instance (no shared memory).
    const job = await (await fetch(`${COORDINATOR_URL}/v1/jobs/${jobId}`)).json();
    const specHash = job.job.worker_spec_hash as string;
    const wasmBytes = await (await fetch("/sieve_core.wasm")).arrayBuffer();

    this.workers = [];
    await Promise.all(
      Array.from({ length: threads }, async (_, i) => {
        const w = new Worker(new URL("./evaluator.worker.ts", import.meta.url));
        await new Promise<void>((resolve, reject) => {
          w.onmessage = (e) => (e.data.type === "ready" ? resolve() : reject(new Error(e.data.error)));
          w.postMessage({ type: "init", wasmBytes: wasmBytes.slice(0), expectedHash: specHash }, []);
        });
        this.workers[i] = w;
      })
    );
    this.logLine(`${threads} thread(s) ready · wallet ${this.wallet.slice(0, 8)}…`);
    this.emit({ status: "running" });

    while (this.running) {
      try {
        const advanced = await this.runOneChunk(jobId);
        if (!advanced) break;
      } catch (err) {
        this.logLine(`error: ${(err as Error).message} — retrying in 5s`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    this.stop();
  }

  private async runOneChunk(jobId: string): Promise<boolean> {
    const leaseRes = await fetch(`${COORDINATOR_URL}/v1/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job_id: jobId, wallet_address: this.wallet, payout_address: this.payoutAddress }),
    });
    if (leaseRes.status === 404) {
      this.logLine("job drained — no pending chunks");
      return false;
    }
    if (!leaseRes.ok) throw new Error(`lease → ${leaseRes.status}`);
    const assignment = ChunkAssignment.parse(await leaseRes.json());
    this.emit({ currentChunk: assignment.chunk_id });

    const start = BigInt(assignment.range_start);
    const end = BigInt(assignment.range_end);
    const bucket = BigInt(assignment.bucket_size);
    const bucketsTotal = Number((end - start + bucket - 1n) / bucket);
    const paramsJson = JSON.stringify(assignment.params);
    this.chunkSeedsTotal = Number(end - start);
    this.chunkSeedsDone = 0;
    const t0 = performance.now();

    // Fan out contiguous bucket slices across threads.
    const per = Math.ceil(bucketsTotal / this.workers.length);
    const slices = this.workers
      .map((w, i) => {
        const fromBucket = i * per;
        const toBucket = Math.min(fromBucket + per, bucketsTotal);
        if (fromBucket >= toBucket) return null;
        const sliceStart = start + BigInt(fromBucket) * bucket;
        const sliceEnd = start + BigInt(toBucket) * bucket < end ? start + BigInt(toBucket) * bucket : end;
        return { worker: w, fromBucket, sliceStart, sliceEnd };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const allLeaves: BucketLeaf[] = [];
    await Promise.all(
      slices.map(
        (slice, taskId) =>
          new Promise<void>((resolve, reject) => {
            slice.worker.onmessage = (e) => {
              const m = e.data;
              if (m.type === "progress" && m.taskId === taskId) this.onProgress(m.seedsDone);
              if (m.type === "done" && m.taskId === taskId) {
                for (const l of m.leaves) {
                  allLeaves.push({ index: l.index, maxScore: BigInt(l.maxScore), maxSeed: BigInt(l.maxSeed) });
                }
                resolve();
              }
              if (m.type === "error" && m.taskId === taskId) reject(new Error(m.error));
            };
            slice.worker.postMessage({
              type: "eval",
              taskId,
              rangeStart: slice.sliceStart.toString(),
              rangeEnd: slice.sliceEnd.toString(),
              bucketSize: assignment.bucket_size,
              baseIndex: slice.fromBucket,
              paramsJson,
            });
          })
      )
    );

    allLeaves.sort((a, b) => a.index - b.index);
    // Extremum fold: ascending, strictly greater — protocol tie-break rule.
    let best = allLeaves[0]!;
    for (const leaf of allLeaves) if (leaf.maxScore > best.maxScore) best = leaf;
    const root = toHex(merkleRoot(allLeaves.map(hashLeaf)));

    this.retained.set(assignment.chunk_id, allLeaves);
    if (this.retained.size > 8) this.retained.delete(this.retained.keys().next().value as string);

    const unsigned: UnsignedResult = {
      chunk_id: assignment.chunk_id,
      worker_spec_hash: assignment.worker_spec_hash,
      extremum_score: best.maxScore.toString(),
      witness_seed: best.maxSeed.toString(),
      merkle_root: root,
      buckets_count: allLeaves.length,
      seeds_evaluated: (end - start).toString(),
      duration_ms: Math.round(performance.now() - t0),
      nonce: assignment.nonce,
    };
    // Signing happens HERE, in host code — never inside a worker thread.
    const submission = { ...unsigned, signature: signResult(unsigned, this.seed) };

    const submitRes = await fetch(`${COORDINATOR_URL}/v1/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!submitRes.ok) throw new Error(`submit → ${submitRes.status}`);
    let verdict = SubmissionResponse.parse(await submitRes.json());

    // Audited: open the challenged leaves with inclusion proofs from the
    // bucket data we retained. Signing keys are never involved here.
    if (verdict.status === "challenged" && verdict.challenge) {
      const hashes = allLeaves.map(hashLeaf);
      const indices = verdict.challenge.bucket_indices;
      this.logLine(`challenged on ${indices.length} bucket(s) — answering`);
      const answer = {
        result_id: verdict.result_id,
        leaves: indices.map((i) => ({
          index: i,
          max_score: allLeaves[i]!.maxScore.toString(),
          max_seed: allLeaves[i]!.maxSeed.toString(),
        })),
        proofs: indices.map((i) => merkleProof(hashes, i).map(toHex)),
      };
      const judged = await fetch(`${COORDINATOR_URL}/v1/challenge-response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(answer),
      });
      if (!judged.ok) throw new Error(`challenge response → ${judged.status}`);
      const j = (await judged.json()) as { status: "accepted" | "rejected" };
      verdict = { result_id: verdict.result_id, status: j.status };
    }

    if (verdict.status === "accepted") {
      this.emit({ sessionChunks: this.stats.sessionChunks + 1, currentChunk: null });
      this.logLine(`chunk accepted · score ${best.maxScore} · seed ${best.maxSeed}`);
    } else {
      this.emit({ currentChunk: null });
      this.logLine(`chunk rejected`);
    }
    return true;
  }

  private onProgress(seeds: number): void {
    const now = performance.now();
    this.recentProgress.push({ at: now, seeds });
    this.recentProgress = this.recentProgress.filter((p) => now - p.at < 10_000);
    const windowSeeds = this.recentProgress.reduce((a, p) => a + p.seeds, 0);
    const windowMs = Math.max(now - (this.recentProgress[0]?.at ?? now), 1000);
    this.chunkSeedsDone += seeds;
    this.emit({
      seedsPerSec: Math.round(windowSeeds / (windowMs / 1000)),
      sessionSeeds: this.stats.sessionSeeds + seeds,
      chunkProgress: Math.min(1, this.chunkSeedsDone / this.chunkSeedsTotal),
    });
  }

  stop(): void {
    this.running = false;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.emit({ status: "idle", seedsPerSec: 0, currentChunk: null });
  }
}
