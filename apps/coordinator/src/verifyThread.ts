import { parentPort } from "node:worker_threads";
import { bucketDigest16 } from "@sieveworks/wasm-runtime";
import { registry } from "./moduleRegistry.js";

/**
 * Verification worker thread. Recomputes challenged buckets off the main event
 * loop, loading the RIGHT module per job by hash (multi-module). Its own
 * module cache and DB connection. A pathological module can hang here — the
 * main thread guards every call with a timeout and restarts this worker, so a
 * stuck module fails the challenge instead of wedging the pipeline.
 */

interface BucketJob {
  id: number;
  op?: "extremum" | "render"; // absent = extremum (pre-mode messages)
  hash: string;
  rangeStart: string;
  rangeEnd: string;
  paramsJson: string;
  salt16Hex?: string; // render only: job salt for the leaf digest
}

parentPort!.postMessage({ type: "ready" });

parentPort!.on("message", async (job: BucketJob) => {
  try {
    const mod = await registry.get(job.hash);
    if (job.op === "render") {
      const bytes = mod.renderBucket(BigInt(job.rangeStart), BigInt(job.rangeEnd), job.paramsJson);
      const salt = Buffer.from(job.salt16Hex ?? "00".repeat(16), "hex");
      const digest = Buffer.from(bucketDigest16(new Uint8Array(salt), bytes)).toString("hex");
      parentPort!.postMessage({ type: "result", id: job.id, digestHex: digest });
      return;
    }
    const { maxScore, maxSeed } = mod.evaluateRange(BigInt(job.rangeStart), BigInt(job.rangeEnd), job.paramsJson);
    parentPort!.postMessage({ type: "result", id: job.id, maxScore: maxScore.toString(), maxSeed: maxSeed.toString() });
  } catch (err) {
    parentPort!.postMessage({ type: "result", id: job.id, error: (err as Error).message });
  }
});
