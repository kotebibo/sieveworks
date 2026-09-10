import { randomInt } from "node:crypto";
import {
  fromHex,
  hashLeaf,
  merkleRoot,
  toHex,
  verifyProof,
  type BucketLeaf,
} from "@sieveworks/merkle";
import {
  digest16ToWire,
  wireToDigest16,
  type ChallengeResponse,
  type ResultSubmission,
  type SubmissionResponse,
} from "@sieveworks/protocol";
import { bucketDigest16 } from "@sieveworks/wasm-runtime";
import { createHash } from "node:crypto";
import { candidatePool } from "./candidates.js";
import type { BucketPool } from "./bucketPool.js";
import { attestFind, chainEnabled } from "./chain.js";
import { sql } from "./db.js";
import { events } from "./events.js";
import type { LeaseStore } from "./leases.js";
import { registry } from "./moduleRegistry.js";
import { notify } from "./notifications.js";

/**
 * The verification pipeline (spec §8). Layered so each check catches what the
 * others can't:
 *   witness  → over-reporting (claimed score isn't real)
 *   honeypot → under-reporting (skipped work missed a known-better seed)
 *   challenge → fabricated commitments (can't open buckets never computed)
 * Rejections are OPAQUE to workers; reasons live in result_rejections only.
 */

const AUDIT_RATE_PCT = Number(process.env.AUDIT_RATE_PCT ?? 5);
// output_hash has ONE detection layer (challenge recompute) instead of three,
// so it samples at a higher default rate (Spec 01 §5).
const OUTPUT_AUDIT_RATE_PCT = Number(process.env.OUTPUT_AUDIT_RATE_PCT ?? 10);
const CHALLENGE_BUCKETS = 8;
export const CHALLENGE_WINDOW_S = Number(process.env.CHALLENGE_WINDOW_S ?? 90);
export const OUTPUT_DELIVERY_WINDOW_S = Number(process.env.OUTPUT_DELIVERY_WINDOW_S ?? 600);

export interface VerifyDeps {
  bucketPool: BucketPool;
  leases: LeaseStore;
}

interface SubmissionContext {
  chunkId: string;
  jobId: string;
  workerId: string;
  specHash: string;
  mode: string; // jobs.verification_mode
  rangeStart: bigint;
  rangeEnd: bigint;
  bucketSize: number;
  params: Record<string, unknown>;
  pricePerChunk: string;
  currentRecordScore: bigint | null;
}

/** The mode-2/3 leaf digest salt is the job's own UUID bytes. */
export function jobSalt16Hex(jobId: string): string {
  return jobId.replace(/-/g, "").toLowerCase();
}

type RejectReason =
  | "witness_failed"
  | "honeypot_failed"
  | "challenge_failed"
  | "challenge_timeout";

export async function verifySubmission(
  deps: VerifyDeps,
  resultId: string,
  sub: ResultSubmission,
  ctx: SubmissionContext
): Promise<SubmissionResponse> {
  if (ctx.mode === "output_hash") return verifyOutputHash(deps, resultId, sub, ctx);
  if (ctx.mode === "training") return verifyTraining(deps, resultId, sub, ctx);
  return verifyExtremum(deps, resultId, sub, ctx);
}

const TRAINING_AUDIT_RATE_PCT = Number(process.env.TRAINING_AUDIT_RATE_PCT ?? 10);

/** A lineage's generation-0 state is a pure function of (job, lineage) —
 * both sides derive the same 32-byte seed, so the origin cannot be chosen
 * by the worker (Spec 03 anchoring). */
export function lineageSeed32(jobId: string, lineageId: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(`sieveworks-lineage:${jobId}:${lineageId}`).digest());
}

/** Mode 3 (Spec 03): the chunk is a lineage segment. Witness = the best
 * genome ever seen (O(1) re-evaluation); work-proof = transition challenges
 * (bucket 0 ALWAYS sampled — the origin anchor). Payment waits on final-
 * state delivery, which is also what lets the lineage continue. */
async function verifyTraining(
  deps: VerifyDeps,
  resultId: string,
  sub: ResultSubmission,
  ctx: SubmissionContext
): Promise<SubmissionResponse> {
  if (sub.extremum_score === undefined || sub.best_candidate_b64 === undefined) {
    await rejectResult(deps, resultId, ctx, "witness_failed", { slash: false, detail: "training submission missing witness fields" });
    return { result_id: resultId, status: "rejected" };
  }
  // 1. WITNESS — the claimed best genome must reproduce the claimed score
  // (one deterministic evaluation, in the isolated candidate pool).
  let reeval: bigint;
  try {
    reeval = await candidatePool.evaluateCandidate(ctx.specHash, sub.best_candidate_b64, JSON.stringify(ctx.params));
  } catch {
    await rejectResult(deps, resultId, ctx, "witness_failed", { slash: true, detail: "witness genome failed evaluation" });
    return { result_id: resultId, status: "rejected" };
  }
  if (reeval !== BigInt(sub.extremum_score)) {
    await rejectResult(deps, resultId, ctx, "witness_failed", {
      slash: true,
      detail: `witness genome scores ${reeval}, claimed ${sub.extremum_score}`,
    });
    return { result_id: resultId, status: "rejected" };
  }

  // 2. CHALLENGE DECISION — no honeypots exist in this mode; the audit rate
  // is higher to compensate, and bucket 0 is ALWAYS in the sample (origin
  // anchor: a chain not grown from the forced origin dies here).
  const [prior] = await sql<{ n: number }[]>`
    select count(*)::int as n from results
    where worker_id = ${ctx.workerId} and id != ${resultId}
      and verification_state = 'passed'`;
  const challenged = prior!.n < 3 || randomInt(100) < TRAINING_AUDIT_RATE_PCT;
  if (!challenged) {
    await awaitOutputs(deps, resultId, ctx);
    return { result_id: resultId, status: "accepted" };
  }

  const n = sub.buckets_count;
  const k = Math.min(n, Math.max(CHALLENGE_BUCKETS, Math.ceil(n / 4)));
  const picked = new Set<number>([0]);
  while (picked.size < k) picked.add(randomInt(n));
  const indices = [...picked].sort((a, b) => a - b);
  const indicesLiteral = `{${indices.join(",")}}`;
  await sql`insert into challenges (result_id, bucket_indices)
            values (${resultId}, ${indicesLiteral}::int[])`;
  await sql`update results set verification_state = 'challenged' where id = ${resultId}`;
  await sql`update chunks set state = 'verifying' where id = ${ctx.chunkId}`;
  events.emit("chunk_challenged", { chunk_id: ctx.chunkId, job_id: ctx.jobId });
  return {
    result_id: resultId,
    status: "challenged",
    challenge: { result_id: resultId, bucket_indices: indices },
  };
}

async function verifyExtremum(
  deps: VerifyDeps,
  resultId: string,
  sub: ResultSubmission,
  ctx: SubmissionContext
): Promise<SubmissionResponse> {
  // Belt: an extremum job can only verify extremum-shaped submissions (the
  // route already rejects mode mismatches before insert).
  if (sub.witness_seed === undefined || sub.extremum_score === undefined) {
    await rejectResult(deps, resultId, ctx, "witness_failed", {
      slash: false,
      detail: "submission shape does not match job mode",
    });
    return { result_id: resultId, status: "rejected" };
  }
  const witness = BigInt(sub.witness_seed);
  const claimed = BigInt(sub.extremum_score);
  const paramsJson = JSON.stringify(ctx.params);

  // 1. WITNESS — the seed must lie in the range and reproduce the score.
  if (witness < ctx.rangeStart || witness >= ctx.rangeEnd) {
    await rejectResult(deps, resultId, ctx, "witness_failed", {
      slash: true,
      detail: "witness outside chunk range",
    });
    return { result_id: resultId, status: "rejected" };
  }
  const mod = await registry.get(ctx.specHash);
  const recomputed = mod.evaluateSeed(witness, paramsJson);
  if (recomputed !== claimed) {
    await rejectResult(deps, resultId, ctx, "witness_failed", {
      slash: true,
      detail: `witness scores ${recomputed}, claimed ${claimed}`,
    });
    return { result_id: resultId, status: "rejected" };
  }

  // 2. HONEYPOT — a known seed in this range scoring above the claimed max
  // proves the range wasn't searched. The assignment was never modified, so
  // this is undetectable from the worker's side.
  const [pot] = await sql`
    select seed::text, score::text from honeypots
    where job_id = ${ctx.jobId}
      and seed >= ${ctx.rangeStart.toString()} and seed < ${ctx.rangeEnd.toString()}
      and score > ${claimed.toString()}
    limit 1`;
  if (pot) {
    await rejectResult(deps, resultId, ctx, "honeypot_failed", {
      slash: true,
      honeypot_seed: pot.seed,
      honeypot_score: pot.score,
    });
    return { result_id: resultId, status: "rejected" };
  }

  // 3. CHALLENGE DECISION — 100% for a worker's first 3 chunks and for any
  // record claim; AUDIT_RATE_PCT otherwise.
  const isRecord = ctx.currentRecordScore === null || claimed > ctx.currentRecordScore;
  // PASSED only (hardening, adversarial review 2026-09-11): counting failed
  // results let a new wallet age out of the mandatory-audit window with three
  // free garbage submissions. Only honestly-passed work builds trust.
  const [prior] = await sql<{ n: number }[]>`
    select count(*)::int as n from results
    where worker_id = ${ctx.workerId} and id != ${resultId}
      and verification_state = 'passed'`;
  const mustChallenge = prior!.n < 3 || isRecord;
  const challenged = mustChallenge || randomInt(100) < AUDIT_RATE_PCT;

  if (!challenged) {
    await acceptResult(deps, resultId, sub, ctx, isRecord);
    return { result_id: resultId, status: "accepted" };
  }

  const bucketsCount = sub.buckets_count;
  const indices = sampleIndices(Math.min(CHALLENGE_BUCKETS, bucketsCount), bucketsCount);
  // postgres.js infers a JS number[] as text[]; pass a literal and cast.
  const indicesLiteral = `{${indices.join(",")}}`;
  await sql`insert into challenges (result_id, bucket_indices)
            values (${resultId}, ${indicesLiteral}::int[])`;
  await sql`update results set verification_state = 'challenged' where id = ${resultId}`;
  await sql`update chunks set state = 'verifying' where id = ${ctx.chunkId}`;
  events.emit("chunk_challenged", { chunk_id: ctx.chunkId, job_id: ctx.jobId });
  return {
    result_id: resultId,
    status: "challenged",
    challenge: { result_id: resultId, bucket_indices: indices },
  };
}

/** Mode 2 (Spec 01): no witness, no honeypots — digests carry no ordering,
 * so the ONLY detection layer is the challenge recompute; it samples at a
 * higher rate to compensate, and is forced for a worker's first 3 PASSED
 * results. Payment NEVER happens here — verification passing moves the
 * chunk to awaiting_outputs, and only digest-checked delivery of the full
 * output (which recomputes the committed root) credits earnings. */
async function verifyOutputHash(
  deps: VerifyDeps,
  resultId: string,
  sub: ResultSubmission,
  ctx: SubmissionContext
): Promise<SubmissionResponse> {
  const [prior] = await sql<{ n: number }[]>`
    select count(*)::int as n from results
    where worker_id = ${ctx.workerId} and id != ${resultId}
      and verification_state = 'passed'`;
  const challenged = prior!.n < 3 || randomInt(100) < OUTPUT_AUDIT_RATE_PCT;

  if (!challenged) {
    await awaitOutputs(deps, resultId, ctx);
    return { result_id: resultId, status: "accepted" };
  }

  const bucketsCount = sub.buckets_count;
  const indices = sampleIndices(Math.min(CHALLENGE_BUCKETS, bucketsCount), bucketsCount);
  const indicesLiteral = `{${indices.join(",")}}`;
  await sql`insert into challenges (result_id, bucket_indices)
            values (${resultId}, ${indicesLiteral}::int[])`;
  await sql`update results set verification_state = 'challenged' where id = ${resultId}`;
  await sql`update chunks set state = 'verifying' where id = ${ctx.chunkId}`;
  events.emit("chunk_challenged", { chunk_id: ctx.chunkId, job_id: ctx.jobId });
  return {
    result_id: resultId,
    status: "challenged",
    challenge: { result_id: resultId, bucket_indices: indices },
  };
}

/** Verification passed for a mode-2 result; the chunk now waits for the
 * worker to deliver the actual output bytes. NO earnings credit here —
 * delivery gates payment (adversarial-review invariant: credit must never
 * precede delivery, there is no clawback path). */
async function awaitOutputs(deps: VerifyDeps, resultId: string, ctx: SubmissionContext): Promise<void> {
  await sql`update results set verification_state = 'passed', verified_at = now() where id = ${resultId}`;
  await sql`update chunks set state = 'awaiting_outputs' where id = ${ctx.chunkId}`;
  await deps.leases.clear(ctx.chunkId);
  events.emit("chunk_verified", { chunk_id: ctx.chunkId, job_id: ctx.jobId });
}

/** Judge a worker's challenge response: inclusion proofs against the
 * committed root, then recompute every challenged bucket in the thread. */
export async function judgeChallengeResponse(
  deps: VerifyDeps,
  response: ChallengeResponse
): Promise<"accepted" | "rejected"> {
  const [row] = await sql`
    select ch.id as challenge_id, ch.bucket_indices,
           r.id as result_id, r.merkle_root, r.buckets_count, r.extremum_score::text,
           r.witness_seed::text,
           c.id as chunk_id, c.range_start::text, c.range_end::text,
           j.id as job_id, j.bucket_size, j.params, j.price_per_chunk_lamports::text,
           j.current_record_score, j.worker_spec_hash, j.verification_mode, r.worker_id
    from challenges ch
    join results r on r.id = ch.result_id
    join chunks c on c.id = r.chunk_id
    join jobs j on j.id = c.job_id
    where ch.result_id = ${response.result_id} and ch.passed is null
    order by ch.issued_at desc limit 1`;
  if (!row) throw Object.assign(new Error("no open challenge"), { code: 404 });

  const ctx: SubmissionContext = {
    chunkId: row.chunk_id,
    jobId: row.job_id,
    workerId: row.worker_id,
    specHash: row.worker_spec_hash,
    mode: row.verification_mode,
    rangeStart: BigInt(row.range_start),
    rangeEnd: BigInt(row.range_end),
    bucketSize: row.bucket_size,
    params: row.params,
    pricePerChunk: row.price_per_chunk_lamports,
    currentRecordScore: row.current_record_score === null ? null : BigInt(row.current_record_score),
  };
  await sql`update challenges set response = ${sql.json(response as never)}, responded_at = now()
            where id = ${row.challenge_id}`;

  const fail = async (detail: string): Promise<"rejected"> => {
    await sql`update challenges set passed = false where id = ${row.challenge_id}`;
    await rejectResult(deps, row.result_id, ctx, "challenge_failed", { slash: true, detail });
    return "rejected";
  };

  // The response must open exactly the challenged indices.
  const wanted = [...(row.bucket_indices as number[])].sort((a, b) => a - b);
  const got = response.leaves.map((l) => l.index).sort((a, b) => a - b);
  if (wanted.length !== got.length || wanted.some((w, i) => w !== got[i])) {
    return fail("wrong bucket indices opened");
  }
  if (response.proofs.length !== response.leaves.length) {
    return fail("proof count mismatch");
  }

  const root = fromHex(row.merkle_root);
  const paramsJson = JSON.stringify(ctx.params);
  for (let i = 0; i < response.leaves.length; i++) {
    const l = response.leaves[i]!;
    const leaf: BucketLeaf = { index: l.index, maxScore: BigInt(l.max_score), maxSeed: BigInt(l.max_seed) };
    const proof = response.proofs[i]!.map(fromHex);
    // Inclusion: was this leaf really committed under the submitted root?
    // (Identical for digest modes — the leaf encoding is the same 21 bytes;
    // the payload is simply an opaque digest there.)
    if (!verifyProof(leaf, proof, row.buckets_count, root)) {
      return fail(`leaf ${l.index} not in committed tree`);
    }
    // Truth: recompute the bucket with the same WASM the worker ran.
    const bStart = ctx.rangeStart + BigInt(l.index) * BigInt(ctx.bucketSize);
    const bEndRaw = bStart + BigInt(ctx.bucketSize);
    const bEnd = bEndRaw < ctx.rangeEnd ? bEndRaw : ctx.rangeEnd;
    if (ctx.mode === "output_hash") {
      const truthHex = await deps.bucketPool.renderBucketDigest(
        ctx.specHash, bStart, bEnd, paramsJson, jobSalt16Hex(ctx.jobId));
      const committedHex = Buffer.from(
        wireToDigest16({ score: l.max_score, seed: l.max_seed })).toString("hex");
      if (truthHex !== committedHex) {
        return fail(`bucket ${l.index}: committed digest ${committedHex} but truth is ${truthHex}`);
      }
      continue;
    }
    if (ctx.mode === "training") {
      // A challenged bucket is a STATE TRANSITION: resolve the start state,
      // anchor it (origin derivation for bucket 0, committed prev-leaf digest
      // otherwise), recompute the transition, compare the end digest.
      const salt = Buffer.from(jobSalt16Hex(ctx.jobId), "hex");
      const stateB64 = response.states_b64?.[i];
      let startState: Uint8Array;
      if (l.index === 0) {
        const [chunkRow] = await sql<{ lineage_id: string | null; generation_offset: string | null }[]>`
          select lineage_id, generation_offset::text from chunks where id = ${ctx.chunkId}`;
        if (!chunkRow?.lineage_id) return fail("training chunk has no lineage");
        if (chunkRow.generation_offset === "0" || chunkRow.generation_offset === null) {
          const mod = await registry.get(ctx.specHash);
          startState = mod.initState(lineageSeed32(ctx.jobId, chunkRow.lineage_id), paramsJson);
        } else {
          const [lin] = await sql<{ latest_state: Buffer | null }[]>`
            select latest_state from lineages where id = ${chunkRow.lineage_id}`;
          if (!lin?.latest_state) return fail("lineage has no stored predecessor state");
          startState = new Uint8Array(lin.latest_state);
        }
      } else {
        if (!stateB64) return fail(`bucket ${l.index}: start state not provided`);
        startState = new Uint8Array(Buffer.from(stateB64, "base64"));
        // The provided state must be the one COMMITTED at leaf index-1.
        const prev = response.prev_leaves?.[i];
        const prevProof = response.prev_proofs?.[i];
        if (!prev || !prevProof) return fail(`bucket ${l.index}: previous leaf not opened`);
        if (prev.index !== l.index - 1) return fail(`bucket ${l.index}: wrong previous leaf index`);
        const prevLeaf: BucketLeaf = { index: prev.index, maxScore: BigInt(prev.max_score), maxSeed: BigInt(prev.max_seed) };
        if (!verifyProof(prevLeaf, prevProof.map(fromHex), row.buckets_count, root)) {
          return fail(`bucket ${l.index}: previous leaf not in committed tree`);
        }
        const stateDigest = Buffer.from(bucketDigest16(new Uint8Array(salt), startState)).toString("hex");
        const committedPrev = Buffer.from(wireToDigest16({ score: prev.max_score, seed: prev.max_seed })).toString("hex");
        if (stateDigest !== committedPrev) {
          return fail(`bucket ${l.index}: provided start state does not match the committed chain`);
        }
      }
      const advancedHex = await deps.bucketPool.advanceBucketDigest(
        ctx.specHash, Buffer.from(startState).toString("base64"), paramsJson, jobSalt16Hex(ctx.jobId));
      const committedHex = Buffer.from(wireToDigest16({ score: l.max_score, seed: l.max_seed })).toString("hex");
      if (advancedHex !== committedHex) {
        return fail(`bucket ${l.index}: transition recompute diverges from the committed chain`);
      }
      continue;
    }
    const truth = await deps.bucketPool.evaluateBucket(ctx.specHash, bStart, bEnd, paramsJson);
    if (truth.maxScore !== leaf.maxScore || truth.maxSeed !== leaf.maxSeed) {
      return fail(
        `bucket ${l.index}: committed (${leaf.maxScore}, ${leaf.maxSeed}) but truth is (${truth.maxScore}, ${truth.maxSeed})`
      );
    }
  }

  await sql`update challenges set passed = true where id = ${row.challenge_id}`;

  if (ctx.mode === "output_hash" || ctx.mode === "training") {
    // Verification passed; payment still waits on delivery.
    await awaitOutputs(deps, row.result_id, ctx);
    return "accepted";
  }

  const claimed = BigInt(row.extremum_score);
  const isRecord = ctx.currentRecordScore === null || claimed > ctx.currentRecordScore;
  const sub = {
    witness_seed: row.witness_seed,
    extremum_score: row.extremum_score,
  } as ResultSubmission;
  await acceptResult(deps, row.result_id, sub, ctx, isRecord);
  return "accepted";
}

/** Mode-2 output delivery (Spec 01 §3/§5). The worker delivers EVERY
 * bucket's bytes in index order; the coordinator digests each with the job
 * salt, rebuilds the Merkle root, and requires it to equal the committed
 * root from the submission. No signature needed: only bytes matching the
 * commitment are accepted, whoever sends them — correctness IS the auth.
 * Success stores the bytes and, only then, credits earnings ("delivery
 * gates payment"). */
export async function deliverOutputs(
  deps: VerifyDeps,
  resultId: string,
  outputs: Uint8Array[]
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  const [row] = await sql`
    select r.id as result_id, r.merkle_root, r.buckets_count, r.worker_id,
           c.id as chunk_id, c.state as chunk_state,
           j.id as job_id, j.price_per_chunk_lamports::text, j.verification_mode
    from results r
    join chunks c on c.id = r.chunk_id
    join jobs j on j.id = c.job_id
    where r.id = ${resultId}`;
  if (!row) return { ok: false, error: "unknown result", code: 404 };
  if (row.verification_mode !== "output_hash") return { ok: false, error: "job takes no output delivery", code: 409 };
  if (row.chunk_state !== "awaiting_outputs") return { ok: false, error: "chunk not awaiting outputs", code: 409 };
  if (outputs.length !== row.buckets_count) {
    return { ok: false, error: `expected ${row.buckets_count} bucket outputs, got ${outputs.length}`, code: 422 };
  }

  const salt = Buffer.from(jobSalt16Hex(row.job_id), "hex");
  const leafHashes = outputs.map((bytes, index) => {
    const wire = digest16ToWire(bucketDigest16(new Uint8Array(salt), bytes));
    const leaf: BucketLeaf = { index, maxScore: BigInt(wire.score), maxSeed: BigInt(wire.seed) };
    return hashLeaf(leaf);
  });
  if (toHex(merkleRoot(leafHashes)) !== row.merkle_root) {
    // Wrong bytes — possibly an upload bug, never proven fraud. The chunk
    // stays in awaiting_outputs so a corrected delivery can retry until the
    // window expires (expireDeliveries).
    return { ok: false, error: "outputs do not match the committed root", code: 422 };
  }

  const rows = outputs.map((bytes, index) => ({
    result_id: resultId,
    bucket_index: index,
    bytes: Buffer.from(bytes),
  }));
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await sql`insert into chunk_outputs ${sql(rows.slice(i, i + BATCH))} on conflict do nothing`;
  }

  // Delivery verified against the commitment → NOW the chunk is accepted
  // and earnings are credited (never before this point, by review invariant).
  await sql`update chunks set state = 'accepted' where id = ${row.chunk_id}`;
  await sql`
    insert into earnings (worker_id, job_id, cumulative_lamports)
    values (${row.worker_id}, ${row.job_id}, ${row.price_per_chunk_lamports})
    on conflict (worker_id, job_id)
    do update set cumulative_lamports = earnings.cumulative_lamports + ${row.price_per_chunk_lamports},
                  updated_at = now()`;
  events.emit("chunk_accepted", { chunk_id: row.chunk_id, job_id: row.job_id });
  events.emit("outputs_delivered", { chunk_id: row.chunk_id, job_id: row.job_id, result_id: resultId });
  await maybeCompleteJob(row.job_id);
  return { ok: true };
}

/** Training delivery (Spec 03): the worker hands over the FINAL STATE,
 * proven against the commitment (last leaf inclusion + salted digest).
 * Only then: earnings credit, lineage update, and the ROLLING creation of
 * the successor chunk — inserted BEFORE the completion check so a lineage
 * between chunks can never read as "done". */
export async function deliverTrainingState(
  deps: VerifyDeps,
  resultId: string,
  stateB64: string,
  lastLeaf: { index: number; max_score: string; max_seed: string },
  proofHex: string[]
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  const [row] = await sql`
    select r.id as result_id, r.merkle_root, r.buckets_count, r.worker_id,
           c.id as chunk_id, c.state as chunk_state, c.range_start::text, c.range_end::text,
           c.lineage_id, c.generation_offset::text,
           j.id as job_id, j.price_per_chunk_lamports::text, j.verification_mode,
           j.chunk_size::text, j.search_space_end::text, j.params, j.worker_spec_hash
    from results r
    join chunks c on c.id = r.chunk_id
    join jobs j on j.id = c.job_id
    where r.id = ${resultId}`;
  if (!row) return { ok: false, error: "unknown result", code: 404 };
  if (row.verification_mode !== "training") return { ok: false, error: "job takes no state delivery", code: 409 };
  if (row.chunk_state !== "awaiting_outputs") return { ok: false, error: "chunk not awaiting outputs", code: 409 };
  if (!row.lineage_id) return { ok: false, error: "chunk has no lineage", code: 409 };
  if (lastLeaf.index !== row.buckets_count - 1) {
    return { ok: false, error: "delivered leaf must be the final bucket", code: 422 };
  }

  const root = fromHex(row.merkle_root);
  const leaf: BucketLeaf = { index: lastLeaf.index, maxScore: BigInt(lastLeaf.max_score), maxSeed: BigInt(lastLeaf.max_seed) };
  if (!verifyProof(leaf, proofHex.map(fromHex), row.buckets_count, root)) {
    return { ok: false, error: "final leaf not in committed tree", code: 422 };
  }
  const state = new Uint8Array(Buffer.from(stateB64, "base64"));
  const salt = Buffer.from(jobSalt16Hex(row.job_id), "hex");
  const stateDigest = Buffer.from(bucketDigest16(new Uint8Array(salt), state)).toString("hex");
  const committed = Buffer.from(wireToDigest16({ score: lastLeaf.max_score, seed: lastLeaf.max_seed })).toString("hex");
  if (stateDigest !== committed) {
    return { ok: false, error: "state does not match the committed final leaf", code: 422 };
  }

  // Lineage bookkeeping: the state carries the lineage's best-ever.
  const mod = await registry.get(row.worker_spec_hash);
  const witness = mod.bestOfState(state, JSON.stringify(row.params));
  const bestScore = new DataView(witness.buffer, witness.byteOffset).getBigInt64(0, true);
  const bestGenome = Buffer.from(witness.slice(8));

  const G = BigInt(row.chunk_size);
  const gensDone = BigInt(row.generation_offset ?? "0") + G;
  await sql`
    update lineages set latest_state = ${Buffer.from(state)},
      generations_done = ${gensDone.toString()},
      best_score = ${bestScore.toString()}, best_genome = ${bestGenome},
      updated_at = now()
    where id = ${row.lineage_id}`;

  // ROLL the successor before anything can run the completion check. The
  // lineage's slice of the range is [idx*perLineage, (idx+1)*perLineage);
  // this chunk ends at range_end — the next starts there if room remains.
  const M = Math.max(1, Number((row.params as { lineages?: unknown }).lineages ?? 1));
  const perLineage = BigInt(row.search_space_end) / BigInt(M);
  const nextStart = BigInt(row.range_end);
  const lineageEnd = (BigInt(row.range_start) / perLineage + 1n) * perLineage;
  if (nextStart < lineageEnd) {
    await sql`
      insert into chunks (job_id, range_start, range_end, lineage_id, generation_offset)
      values (${row.job_id}, ${nextStart.toString()}, ${(nextStart + G).toString()},
              ${row.lineage_id}, ${gensDone.toString()})
      on conflict (job_id, range_start) do nothing`;
  }

  await sql`update chunks set state = 'accepted' where id = ${row.chunk_id}`;
  await sql`
    insert into earnings (worker_id, job_id, cumulative_lamports)
    values (${row.worker_id}, ${row.job_id}, ${row.price_per_chunk_lamports})
    on conflict (worker_id, job_id)
    do update set cumulative_lamports = earnings.cumulative_lamports + ${row.price_per_chunk_lamports},
                  updated_at = now()`;
  events.emit("chunk_accepted", { chunk_id: row.chunk_id, job_id: row.job_id });
  events.emit("lineage_advanced", {
    job_id: row.job_id,
    lineage_id: row.lineage_id,
    generations_done: gensDone.toString(),
    best_score: bestScore.toString(),
  });
  await maybeCompleteJob(row.job_id);
  return { ok: true };
}

/** Fail deliveries that never arrived: awaiting_outputs older than the
 * window returns to the pool with NO earnings ever granted (and no slash —
 * non-delivery is not proven fraud, it is just unpaid). */
export async function expireDeliveries(deps: VerifyDeps): Promise<number> {
  const stale = await sql<{ result_id: string; chunk_id: string; job_id: string }[]>`
    select r.id as result_id, c.id as chunk_id, c.job_id
    from chunks c
    join results r on r.chunk_id = c.id and r.verification_state = 'passed'
    where c.state = 'awaiting_outputs'
      and r.verified_at < now() - make_interval(secs => ${OUTPUT_DELIVERY_WINDOW_S})`;
  for (const row of stale) {
    await sql`update results set verification_state = 'failed' where id = ${row.result_id}`;
    await sql`
      insert into result_rejections (result_id, reason, detail)
      values (${row.result_id}, 'output_delivery_timeout', ${sql.json({ slash: false } as never)})
      on conflict (result_id) do nothing`;
    await sql`
      update chunks set state = 'pending', leased_to = null, lease_nonce = null,
        lease_expires_at = null, leased_at = null, attempts = attempts + 1
      where id = ${row.chunk_id}`;
    await deps.leases.clear(row.chunk_id);
    events.emit("chunk_reclaimed", { chunk_id: row.chunk_id, job_id: row.job_id, reason: "output_delivery_timeout" });
  }
  return stale.length;
}

/** Bounty completion: when the last chunk is accepted, close the job and
 * notify the funder (fires once, on the open→closed transition). */
async function maybeCompleteJob(jobId: string): Promise<void> {
  const [remaining] = await sql<{ n: number }[]>`
    select count(*)::int as n from chunks where job_id = ${jobId} and state <> 'accepted'`;
  if (remaining!.n === 0) {
    const closed = await sql<{ creator_id: string }[]>`
      update jobs set status = 'closed', closed_at = now()
      where id = ${jobId} and status = 'open' returning creator_id`;
    if (closed.length > 0) {
      const [creator] = await sql<{ wallet_address: string }[]>`select wallet_address from users where id = ${closed[0]!.creator_id}`;
      if (creator) {
        await notify(creator.wallet_address, "bounty_complete", "Your bounty is complete",
          `All chunks verified. Download the top-scoring results as CSV.`, `/bounties/${jobId}`);
      }
      events.emit("bounty_complete", { job_id: jobId });
    }
  }
}

/** Fail every challenge whose window expired without a response. A worker
 * that computed honestly but discarded its buckets is indistinguishable from
 * one that never computed them (spec §5). Called by the sweeper. */
export async function expireChallenges(deps: VerifyDeps): Promise<number> {
  const expired = await sql`
    select ch.id as challenge_id, r.id as result_id,
           c.id as chunk_id, c.range_start::text, c.range_end::text,
           j.id as job_id, j.bucket_size, j.params, j.price_per_chunk_lamports::text,
           j.current_record_score, j.worker_spec_hash, j.verification_mode, r.worker_id
    from challenges ch
    join results r on r.id = ch.result_id
    join chunks c on c.id = r.chunk_id
    join jobs j on j.id = c.job_id
    where ch.passed is null and ch.responded_at is null
      and ch.issued_at < now() - make_interval(secs => ${CHALLENGE_WINDOW_S})`;
  for (const row of expired) {
    await sql`update challenges set passed = false where id = ${row.challenge_id}`;
    await rejectResult(
      deps,
      row.result_id,
      {
        chunkId: row.chunk_id,
        jobId: row.job_id,
        workerId: row.worker_id,
        specHash: row.worker_spec_hash,
        mode: row.verification_mode,
        rangeStart: BigInt(row.range_start),
        rangeEnd: BigInt(row.range_end),
        bucketSize: row.bucket_size,
        params: row.params,
        pricePerChunk: row.price_per_chunk_lamports,
        currentRecordScore: null,
      },
      "challenge_timeout",
      { slash: true }
    );
  }

  // Self-heal: a challenge that was ANSWERED but never judged (e.g. the
  // coordinator restarted mid-judge, or a transient error) leaves the chunk
  // stuck in 'verifying' forever — the loop above only catches UNanswered
  // ones. After a short stall window, return the range to the pool WITHOUT
  // slashing: this is a coordinator hiccup, not worker fraud.
  const stalled = await sql<{ challenge_id: string; result_id: string; chunk_id: string; job_id: string }[]>`
    select ch.id as challenge_id, r.id as result_id, c.id as chunk_id, c.job_id
    from challenges ch
    join results r on r.id = ch.result_id
    join chunks c on c.id = r.chunk_id
    where c.state = 'verifying' and ch.passed is null and ch.responded_at is not null
      and ch.responded_at < now() - interval '30 seconds'`;
  for (const row of stalled) {
    await sql`update challenges set passed = false where id = ${row.challenge_id}`;
    await sql`update results set verification_state = 'failed', verified_at = now() where id = ${row.result_id}`;
    await sql`update chunks set state = 'pending', leased_to = null, lease_nonce = null,
      lease_expires_at = null, leased_at = null where id = ${row.chunk_id}`;
    await deps.leases.clear(row.chunk_id);
    events.emit("chunk_reclaimed", { chunk_id: row.chunk_id, job_id: row.job_id, reason: "stalled_challenge" });
  }

  return expired.length + stalled.length;
}

async function acceptResult(
  deps: VerifyDeps,
  resultId: string,
  sub: Pick<ResultSubmission, "witness_seed" | "extremum_score">,
  ctx: SubmissionContext,
  isRecord: boolean
): Promise<void> {
  await sql`update results set verification_state = 'passed', verified_at = now() where id = ${resultId}`;
  await sql`update chunks set state = 'accepted' where id = ${ctx.chunkId}`;
  // Spec §8.5 — credit cumulative earnings. Claiming is Day 4's voucher path.
  await sql`
    insert into earnings (worker_id, job_id, cumulative_lamports)
    values (${ctx.workerId}, ${ctx.jobId}, ${ctx.pricePerChunk})
    on conflict (worker_id, job_id)
    do update set cumulative_lamports = earnings.cumulative_lamports + ${ctx.pricePerChunk},
                  updated_at = now()`;
  await deps.leases.clear(ctx.chunkId);
  events.emit("chunk_accepted", {
    chunk_id: ctx.chunkId,
    job_id: ctx.jobId,
    extremum_score: sub.extremum_score,
    witness_seed: sub.witness_seed,
  });

  // The record path is extremum-only by construction: digest modes have no
  // scalar to compare, so their submissions never set isRecord — the field
  // narrowing here is the type-level mirror of that invariant.
  if (isRecord && sub.extremum_score !== undefined && sub.witness_seed !== undefined) {
    // Captured so the narrowing survives the awaits below.
    const recScore = sub.extremum_score;
    const recSeed = sub.witness_seed;
    // Record path (§8.6): the witness was already deterministically
    // re-verified above and records force a 100% challenge. On-chain
    // attestation lands Day 4; the finds row is its off-chain mirror.
    const updated = await sql`
      update jobs set current_record_score = ${recScore},
                      current_record_seed = ${recSeed}
      where id = ${ctx.jobId}
        and (current_record_score is null or current_record_score < ${recScore})
      returning id`;
    if (updated.length > 0) {
      const inserted = await sql<{ id: string }[]>`
        insert into finds (job_id, worker_id, seed, score, is_record)
        values (${ctx.jobId}, ${ctx.workerId}, ${recSeed}, ${recScore}, true)
        on conflict (job_id, seed) do nothing
        returning id`;
      events.emit("new_record", {
        job_id: ctx.jobId,
        score: recScore,
        seed: recSeed,
      });
      const [finder] = await sql<{ wallet_address: string; payout_address: string | null }[]>`
        select wallet_address, payout_address from users where id = ${ctx.workerId}`;
      if (finder) {
        await notify(finder.wallet_address, "record_found", "You set a new record",
          `Score ${recScore}, seed ${recSeed}. It's now the top find on this bounty.`,
          `/bounties/${ctx.jobId}`);
      }
      // On-chain attestation (spec §9): record_find writes job/seed/score/finder
      // permanently. Fire-and-forget — a slow devnet must never stall the
      // verification pipeline; on failure tx_signature stays null (the PDA is
      // idempotent per (job, seed), so a later retry can't double-record).
      if (inserted.length > 0 && chainEnabled()) {
        const findId = inserted[0]!.id;
        const finderWallet = finder?.payout_address ?? finder?.wallet_address;
        if (finderWallet) {
          void attestFind({
            jobUuid: ctx.jobId,
            seed: BigInt(recSeed),
            score: BigInt(recScore),
            finder: finderWallet,
          })
            .then(async (sig) => {
              if (!sig) return;
              await sql`update finds set tx_signature = ${sig}, attested_at = now() where id = ${findId}`;
              events.emit("find_attested", { job_id: ctx.jobId, seed: recSeed, tx_signature: sig });
            })
            .catch((err) => console.error(`[chain] record_find attestation failed for find ${findId}:`, err));
        }
      }
    }
  }

  await maybeCompleteJob(ctx.jobId);
}

async function rejectResult(
  deps: VerifyDeps,
  resultId: string,
  ctx: SubmissionContext,
  reason: RejectReason,
  detail: Record<string, unknown>
): Promise<void> {
  await sql`update results set verification_state = 'failed', verified_at = now() where id = ${resultId}`;
  await sql`
    insert into result_rejections (result_id, reason, detail)
    values (${resultId}, ${reason}, ${sql.json(detail as never)})
    on conflict (result_id) do nothing`;
  // The range still needs searching — the chunk returns to the pool.
  await sql`
    update chunks set state = 'pending', leased_to = null, lease_nonce = null,
      lease_expires_at = null, leased_at = null, attempts = attempts + 1
    where id = ${ctx.chunkId}`;
  await deps.leases.clear(ctx.chunkId);
  events.emit("chunk_rejected", { chunk_id: ctx.chunkId, job_id: ctx.jobId });
  // Slash decision is recorded in detail.slash; the on-chain burn is Day 4.
}

function sampleIndices(count: number, max: number): number[] {
  const picked = new Set<number>();
  while (picked.size < count) picked.add(randomInt(max));
  return [...picked].sort((a, b) => a - b);
}
