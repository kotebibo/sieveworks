import { Worker } from "node:worker_threads";

/**
 * Main-thread handle to the verification thread. One thread is enough:
 * challenges hit ~5% of submissions and queue naturally in its inbox.
 * Requests resolve in order via an id → resolver map.
 */

interface BucketResult {
  maxScore: bigint;
  maxSeed: bigint;
}

export class BucketPool {
  private worker!: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: BucketResult) => void; reject: (e: Error) => void }
  >();

  async start(): Promise<string> {
    this.worker = new Worker(new URL("./verifyThread.js", import.meta.url));
    const specHash = await new Promise<string>((resolve, reject) => {
      this.worker.once("message", (m: { type: string; specHash?: string }) =>
        m.type === "ready" ? resolve(m.specHash!) : reject(new Error("bad ready message"))
      );
      this.worker.once("error", reject);
    });
    this.worker.on("message", (m: { type: string; id?: number; maxScore?: string; maxSeed?: string; error?: string }) => {
      if (m.type !== "result" || m.id === undefined) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve({ maxScore: BigInt(m.maxScore!), maxSeed: BigInt(m.maxSeed!) });
    });
    this.worker.on("error", (err) => {
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
    });
    return specHash;
  }

  evaluateBucket(rangeStart: bigint, rangeEnd: bigint, paramsJson: string): Promise<BucketResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({
        id,
        rangeStart: rangeStart.toString(),
        rangeEnd: rangeEnd.toString(),
        paramsJson,
      });
    });
  }
}
