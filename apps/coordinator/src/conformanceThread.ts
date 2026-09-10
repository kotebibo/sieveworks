import { randomInt } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { bucketDigest16, SieveWorkerModule, RENDER_OUT_CAP } from "@sieveworks/wasm-runtime";

/**
 * Conformance gate (runs in its own short-lived thread; the parent kills it
 * on timeout). Dispatches on the artifact's own verification_mode export:
 *
 * witness_extremum (mode 0, default): a module is accepted only if it
 *   1. exports the extremum ABI and instantiates (no I/O imports),
 *   2. is DETERMINISTIC — evaluate_range over a fixed range gives identical
 *      output on two runs, and
 *   3. honours the WITNESS INVARIANT — evaluate_seed(bucket_max_seed) equals
 *      the bucket's max score: the exact invariant verification relies on.
 *
 * output_hash (mode 1): the invariant verification relies on is "bytes are
 *   reproducible, independent of call order" — so the gate exercises the
 *   REAL call patterns, not a toy range:
 *   1. a full sequential run (worker pattern) twice in one instance →
 *      byte-identical digests,
 *   2. a random subset recomputed as ISOLATED calls in a FRESH instance
 *      (the coordinator's challenge pattern) → identical to the sequential
 *      run. A module that branches on call order or hidden state fails here.
 *   3. every bucket nonempty and within RENDER_OUT_CAP.
 *
 * training (mode 2): not accepted yet — lands with Spec 03 (Week 2).
 */

const { wasmBase64, paramsJson } = workerData as { wasmBase64: string; paramsJson: string };

const GATE_BUCKETS = 16; // buckets exercised per run
const ISOLATED_SAMPLES = 4; // call-order-independence probes
const ZERO_SALT = new Uint8Array(16); // no job exists at gate time

async function run(): Promise<void> {
  const bytes = new Uint8Array(Buffer.from(wasmBase64, "base64"));
  let mod: SieveWorkerModule;
  try {
    mod = await SieveWorkerModule.load(bytes); // hash unchecked here; caller records it
  } catch (e) {
    return void parentPort!.postMessage({ ok: false, reason: `load failed: ${(e as Error).message}` });
  }

  const specVersion = mod.specVersion();

  // Candidate capability (prize bounties) — orthogonal to mode. Gate:
  // 16 seeded pseudo-random candidates scored TWICE → identical, each call
  // fast enough for the synchronous submission path.
  let supportsCandidates = false;
  if (mod.supportsCandidates) {
    const cands = Array.from({ length: 16 }, (_, i) => {
      const len = 32 + ((i * 37) % 96);
      return Uint8Array.from({ length: len }, (_, j) => (i * 131 + j * 29 + 7) & 0xff);
    });
    const score = (c: Uint8Array) => {
      try { return mod.evaluateCandidate(c, paramsJson).toString(); }
      catch { return "ERR"; }
    };
    const t0 = Date.now();
    const r1 = cands.map(score);
    const r2 = cands.map(score);
    const perCallMs = (Date.now() - t0) / 32;
    if (JSON.stringify(r1) !== JSON.stringify(r2)) {
      return void parentPort!.postMessage({ ok: false, reason: "evaluate_candidate is non-deterministic" });
    }
    if (r1.every((s) => s === "ERR")) {
      return void parentPort!.postMessage({ ok: false, reason: "evaluate_candidate rejected every probe candidate" });
    }
    if (perCallMs > 100) {
      return void parentPort!.postMessage({ ok: false, reason: `evaluate_candidate too slow (${perCallMs.toFixed(0)}ms/call > 100ms)` });
    }
    supportsCandidates = true;
  }

  if (mod.verificationMode === "witness_extremum" && !mod.supportsExtremum) {
    // Candidate-only module (prize bounties): the candidate suite above IS
    // the conformance; there is no range ABI to exercise.
    if (!supportsCandidates) {
      return void parentPort!.postMessage({ ok: false, reason: "module exports no usable ABI" });
    }
    return void parentPort!.postMessage({
      ok: true,
      verification_mode: "witness_extremum",
      supports_candidates: true,
      spec_version: specVersion,
      buckets_checked: 0,
    });
  }

  if (mod.verificationMode === "witness_extremum") {
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
    return void parentPort!.postMessage({
      ok: true,
      verification_mode: "witness_extremum",
      supports_candidates: supportsCandidates,
      spec_version: specVersion,
      sample: run1.slice(0, 4),
      buckets_checked: run1.length,
    });
  }

  if (mod.verificationMode === "output_hash") {
    // Sequential worker pattern, twice, same instance.
    let run1: string[], run2: string[];
    try {
      run1 = renderAll(mod, paramsJson);
      run2 = renderAll(mod, paramsJson);
    } catch (e) {
      return void parentPort!.postMessage({ ok: false, reason: `render failed: ${(e as Error).message}` });
    }
    if (JSON.stringify(run1) !== JSON.stringify(run2)) {
      return void parentPort!.postMessage({ ok: false, reason: "non-deterministic: two sequential runs differ" });
    }
    // Coordinator challenge pattern: isolated calls, fresh instance.
    const fresh = await SieveWorkerModule.load(bytes);
    for (let i = 0; i < ISOLATED_SAMPLES; i++) {
      const idx = randomInt(GATE_BUCKETS);
      const isolated = digestOf(fresh, BigInt(idx), paramsJson);
      if (isolated !== run1[idx]) {
        return void parentPort!.postMessage({
          ok: false,
          reason: `call-order dependence at bucket ${idx}: isolated recompute differs from sequential run`,
        });
      }
    }
    return void parentPort!.postMessage({
      ok: true,
      verification_mode: "output_hash",
      supports_candidates: supportsCandidates,
      spec_version: specVersion,
      sample: run1.slice(0, 4),
      buckets_checked: GATE_BUCKETS,
    });
  }

  return void parentPort!.postMessage({
    ok: false,
    reason: `verification_mode '${mod.verificationMode}' is not accepted yet`,
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

/** Render buckets [0..GATE_BUCKETS) as unit ranges (render jobs use
 * bucket_size 1: one output unit per leaf) and return their digests. */
function renderAll(mod: SieveWorkerModule, params: string): string[] {
  const out: string[] = [];
  for (let i = 0n; i < BigInt(GATE_BUCKETS); i++) {
    out.push(digestOf(mod, i, params));
  }
  return out;
}

function digestOf(mod: SieveWorkerModule, index: bigint, params: string): string {
  const bytes = mod.renderBucket(index, index + 1n, params);
  if (bytes.length === 0 || bytes.length > RENDER_OUT_CAP) {
    throw new Error(`bucket ${index}: output size ${bytes.length} outside (0, ${RENDER_OUT_CAP}]`);
  }
  return Buffer.from(bucketDigest16(ZERO_SALT, bytes)).toString("hex");
}

run().catch((e) => parentPort!.postMessage({ ok: false, reason: `gate error: ${(e as Error).message}` }));
