import { parentPort, workerData } from "node:worker_threads";
import { SieveWorkerModule } from "@sieveworks/wasm-runtime";

/**
 * Conformance gate (runs in its own short-lived thread; the parent kills it on
 * timeout). An uploaded module is accepted only if it:
 *   1. exports the 3 ABI functions and instantiates (no I/O imports),
 *   2. is DETERMINISTIC — evaluate_range over a fixed range gives identical
 *      output on two runs, and
 *   3. honours the WITNESS INVARIANT — evaluate_seed(bucket_max_seed) equals
 *      the bucket's max score. This is the exact invariant verification relies
 *      on, so a module that fails it here could never pass a challenge.
 * Determinism + the invariant are what let the coordinator trust results from
 * a stranger's module without running it redundantly.
 */

const { wasmBase64, paramsJson } = workerData as { wasmBase64: string; paramsJson: string };

async function run(): Promise<void> {
  const bytes = new Uint8Array(Buffer.from(wasmBase64, "base64"));
  let mod: SieveWorkerModule;
  try {
    mod = await SieveWorkerModule.load(bytes); // hash unchecked here; caller records it
  } catch (e) {
    return void parentPort!.postMessage({ ok: false, reason: `load failed: ${(e as Error).message}` });
  }

  const specVersion = mod.specVersion();
  const start = 0n, end = 8192n, bucket = 1024n;

  const run1 = fold(mod, start, end, bucket, paramsJson);
  const run2 = fold(mod, start, end, bucket, paramsJson);
  if (JSON.stringify(run1) !== JSON.stringify(run2)) {
    return void parentPort!.postMessage({ ok: false, reason: "non-deterministic: two runs over the same range differ" });
  }

  // Witness invariant: every bucket max seed must reproduce its score.
  for (const b of run1) {
    const s = mod.evaluateSeed(BigInt(b.maxSeed), paramsJson);
    if (s.toString() !== b.maxScore) {
      return void parentPort!.postMessage({
        ok: false,
        reason: `witness invariant broken at bucket ${b.index}: evaluate_seed=${s} != bucket max ${b.maxScore}`,
      });
    }
  }

  parentPort!.postMessage({
    ok: true,
    spec_version: specVersion,
    sample: run1.slice(0, 4),
    buckets_checked: run1.length,
  });
}

function fold(mod: SieveWorkerModule, start: bigint, end: bigint, bucket: bigint, params: string) {
  const out: { index: number; maxScore: string; maxSeed: string }[] = [];
  let i = 0;
  for (let s = start; s < end; s += bucket, i++) {
    const e = s + bucket < end ? s + bucket : end;
    const r = mod.evaluateRange(s, e, params);
    out.push({ index: i, maxScore: r.maxScore.toString(), maxSeed: r.maxSeed.toString() });
  }
  return out;
}

run().catch((e) => parentPort!.postMessage({ ok: false, reason: `gate error: ${(e as Error).message}` }));
