import { Worker } from "node:worker_threads";

/**
 * Main-thread handle to the verification thread. Guards every bucket
 * recompute with a timeout: an uploaded module that hangs is killed and the
 * worker restarted, so a malicious/broken module fails one challenge instead
 * of stalling verification. This is the sandbox for untrusted compute — WASM
 * already has no I/O; this bounds its wall-clock.
 */

interface BucketResult {
  maxScore: bigint;
  maxSeed: bigint;
}

interface PendingOp {
  resolve: (r: { maxScore?: string; maxSeed?: string; digestHex?: string }) => void;
  reject: (e: Error) => void;
}

const BUCKET_TIMEOUT_MS = Number(process.env.BUCKET_TIMEOUT_MS ?? 8000);

export class BucketPool {
  private worker!: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingOp>();

  async start(): Promise<void> {
    await this.spawn();
  }

  private async spawn(): Promise<void> {
    this.worker = new Worker(new URL("./verifyThread.js", import.meta.url));
    await new Promise<void>((resolve, reject) => {
      this.worker.once("message", (m: { type: string }) => (m.type === "ready" ? resolve() : reject(new Error("bad ready"))));
      this.worker.once("error", reject);
    });
    this.worker.on("message", (m: { type: string; id?: number; maxScore?: string; maxSeed?: string; digestHex?: string; error?: string }) => {
      if (m.type !== "result" || m.id === undefined) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m);
    });
    this.worker.on("error", (err) => this.failAll(err));
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private async restart(): Promise<void> {
    try {
      await this.worker.terminate();
    } catch {
      /* ignore */
    }
    this.failAll(new Error("verify thread restarted"));
    await this.spawn();
  }

  private dispatch(msg: Record<string, unknown>): Promise<{ maxScore?: string; maxSeed?: string; digestHex?: string }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error("bucket recompute timed out — module too slow or looping"));
          void this.restart();
        }
      }, BUCKET_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.worker.postMessage({ id, ...msg });
    });
  }

  async evaluateBucket(hash: string, rangeStart: bigint, rangeEnd: bigint, paramsJson: string): Promise<BucketResult> {
    const r = await this.dispatch({ op: "extremum", hash, rangeStart: rangeStart.toString(), rangeEnd: rangeEnd.toString(), paramsJson });
    return { maxScore: BigInt(r.maxScore!), maxSeed: BigInt(r.maxSeed!) };
  }

  /** Mode-2 challenge truth: recompute the bucket's output in the thread and
   * return its job-salted 16-byte leaf digest (hex). Bytes never cross the
   * thread boundary — the challenge only compares digests. */
  async renderBucketDigest(hash: string, rangeStart: bigint, rangeEnd: bigint, paramsJson: string, salt16Hex: string): Promise<string> {
    const r = await this.dispatch({ op: "render", hash, rangeStart: rangeStart.toString(), rangeEnd: rangeEnd.toString(), paramsJson, salt16Hex });
    return r.digestHex!;
  }

  /** Training challenge truth: advance one bucket from the provided start
   * state in the thread; return the job-salted digest of the END state.
   * The (large) states never enter the main thread. */
  async advanceBucketDigest(hash: string, stateB64: string, paramsJson: string, salt16Hex: string): Promise<string> {
    const r = await this.dispatch({ op: "advance", hash, rangeStart: "0", rangeEnd: "0", paramsJson, salt16Hex, candidateB64: stateB64 });
    return r.digestHex!;
  }

  /** Prize-bounty candidate re-evaluation (one deterministic fitness call). */
  async evaluateCandidate(hash: string, candidateB64: string, paramsJson: string): Promise<bigint> {
    const r = await this.dispatch({ op: "candidate", hash, rangeStart: "0", rangeEnd: "0", paramsJson, candidateB64 });
    return BigInt(r.maxScore!);
  }
}
