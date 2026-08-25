import { parentPort } from "node:worker_threads";
import { loadVerifier } from "./verifier.js";

/**
 * Verification worker thread. Hosts its OWN hash-verified WASM instance and
 * recomputes challenged buckets (~5.5s for 8×1024 seeds) without blocking the
 * main event loop. Witness checks stay on the main thread — they're sub-ms.
 */

interface BucketJob {
  id: number;
  rangeStart: string; // u64 decimal
  rangeEnd: string;
  paramsJson: string;
}

const verifier = await loadVerifier();
parentPort!.postMessage({ type: "ready", specHash: verifier.specHash });

parentPort!.on("message", (job: BucketJob) => {
  try {
    const { maxScore, maxSeed } = verifier.evaluateRange(
      BigInt(job.rangeStart),
      BigInt(job.rangeEnd),
      job.paramsJson
    );
    parentPort!.postMessage({
      type: "result",
      id: job.id,
      maxScore: maxScore.toString(),
      maxSeed: maxSeed.toString(),
    });
  } catch (err) {
    parentPort!.postMessage({ type: "result", id: job.id, error: (err as Error).message });
  }
});
