import { z } from "zod";
import { i64String, u64String } from "./numeric.js";
import { canonicalBytes } from "./canonical.js";

export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "lowercase sha256 hex");
export const base58Sig = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,120}$/, "base58 ed25519 signature");
export const uuid = z.uuid();
export const isoDatetime = z.iso.datetime({ offset: true });

/** Coordinator → worker. bucket_size is REQUIRED — a defaulted field in a
 * received message would let an omitting coordinator silently produce a
 * different tree shape on the worker, surfacing as a root mismatch. */
export const ChunkAssignment = z
  .object({
    chunk_id: uuid,
    job_id: uuid,
    worker_spec_hash: sha256Hex,
    range_start: u64String,
    range_end: u64String, // exclusive
    bucket_size: z.number().int().min(1).max(1_048_576),
    params: z.record(z.string(), z.unknown()),
    lease_expires_at: isoDatetime,
    nonce: z.string().min(16).max(128),
  })
  .refine((c) => BigInt(c.range_end) > BigInt(c.range_start), "empty or inverted range");
export type ChunkAssignment = z.infer<typeof ChunkAssignment>;

/** How a job's results are verified. Carried by the module artifact itself
 * (optional `verification_mode()` WASM export; absent = witness_extremum,
 * so every pre-mode artifact keeps its hash and meaning). */
export const VerificationMode = z.enum(["witness_extremum", "output_hash", "training"]);
export type VerificationMode = z.infer<typeof VerificationMode>;

export function effectiveMode(mode: VerificationMode | undefined): VerificationMode {
  return mode ?? "witness_extremum";
}

/** Worker → coordinator. `signature` is the worker wallet's ed25519 signature
 * over canonicalBytes of every other field (see resultSigningBytes).
 *
 * `mode` is OPTIONAL with NO zod default, deliberately: canonicalJson drops
 * absent keys, so legacy submissions (no mode on the wire) sign and verify
 * exactly as before, and explicit-mode submissions include the key — no
 * side-channel "was it on the wire" plumbing. Normalize with
 * effectiveMode() in business logic only, never in the schema.
 *
 * Per-mode field rules (enforced by the superRefine):
 *   witness_extremum — extremum_score + witness_seed REQUIRED
 *   output_hash      — both ABSENT (leaves carry digests, not scores)
 *   training         — extremum_score (= best fitness) + best_candidate_b64
 *                      REQUIRED, witness_seed absent
 */
export const ResultSubmission = z
  .object({
    chunk_id: uuid,
    worker_spec_hash: sha256Hex,
    mode: VerificationMode.optional(),
    extremum_score: i64String.optional(),
    witness_seed: u64String.optional(),
    best_candidate_b64: z.string().max(90_000).optional(),
    merkle_root: sha256Hex,
    buckets_count: z.number().int().positive(),
    seeds_evaluated: u64String,
    duration_ms: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(128),
    signature: base58Sig,
  })
  .superRefine((sub, ctx) => {
    const mode = effectiveMode(sub.mode);
    const need = (cond: boolean, message: string) => {
      if (!cond) ctx.addIssue({ code: "custom", message });
    };
    if (mode === "witness_extremum") {
      need(sub.extremum_score !== undefined, "witness_extremum requires extremum_score");
      need(sub.witness_seed !== undefined, "witness_extremum requires witness_seed");
    } else if (mode === "output_hash") {
      need(sub.extremum_score === undefined, "output_hash carries no extremum_score");
      need(sub.witness_seed === undefined, "output_hash carries no witness_seed");
    } else {
      need(sub.extremum_score !== undefined, "training requires extremum_score (best fitness)");
      need(sub.best_candidate_b64 !== undefined, "training requires best_candidate_b64");
      need(sub.witness_seed === undefined, "training carries no witness_seed");
    }
  });
export type ResultSubmission = z.infer<typeof ResultSubmission>;

/** The exact bytes a worker signs and the coordinator verifies. Absent
 * optionals vanish from the canonical form (canonicalJson filters
 * undefined), which is what keeps legacy signatures valid. */
export function resultSigningBytes(submission: Omit<ResultSubmission, "signature">): Uint8Array {
  const { chunk_id, worker_spec_hash, mode, extremum_score, witness_seed, best_candidate_b64, merkle_root, buckets_count, seeds_evaluated, duration_ms, nonce } = submission;
  return canonicalBytes({ chunk_id, worker_spec_hash, mode, extremum_score, witness_seed, best_candidate_b64, merkle_root, buckets_count, seeds_evaluated, duration_ms, nonce });
}

export const Challenge = z.object({
  result_id: uuid,
  bucket_indices: z.array(z.number().int().nonnegative()).min(1).max(64),
});
export type Challenge = z.infer<typeof Challenge>;

export const ChallengeLeaf = z.object({
  index: z.number().int().nonnegative(),
  max_score: i64String,
  max_seed: u64String,
});
export type ChallengeLeaf = z.infer<typeof ChallengeLeaf>;

export const ChallengeResponse = z.object({
  result_id: uuid,
  leaves: z.array(ChallengeLeaf).min(1),
  proofs: z.array(z.array(sha256Hex)), // sibling hashes per leaf, leaf→root order
});
export type ChallengeResponse = z.infer<typeof ChallengeResponse>;

/** Coordinator's answer to a submission. When status is "challenged" the
 * worker must POST a ChallengeResponse within the challenge window or the
 * chunk fails. Rejections carry no reason — deliberately (spec §2.3). */
export const SubmissionResponse = z.object({
  result_id: uuid,
  status: z.enum(["accepted", "rejected", "challenged"]),
  challenge: Challenge.optional(),
});
export type SubmissionResponse = z.infer<typeof SubmissionResponse>;

/** Coordinator's verdict after judging a challenge response. */
export const ChallengeVerdict = z.object({
  result_id: uuid,
  status: z.enum(["accepted", "rejected"]),
});
export type ChallengeVerdict = z.infer<typeof ChallengeVerdict>;

/** WASM exports every conforming worker module must provide. Enforced by
 * wasm-runtime at load time. evaluate_seed is the verification primitive. */
export const WORKER_ABI = ["evaluate_range", "evaluate_seed", "spec_version"] as const;

/** Open prize-bounty submission (Spec 02): anyone, anytime before the
 * deadline — no chunk, no lease. Signed by the submitting worker key so the
 * winner is attributable; verification is one deterministic re-evaluation. */
export const CandidateSubmission = z.object({
  job_id: uuid,
  candidate_b64: z.string().min(1).max(90_000),
  claimed_score: i64String,
  nonce: z.string().min(16).max(128),
  wallet_address: z.string().min(32).max(64),
  signature: base58Sig,
});
export type CandidateSubmission = z.infer<typeof CandidateSubmission>;

export function candidateSigningBytes(sub: Omit<CandidateSubmission, "signature">): Uint8Array {
  const { job_id, candidate_b64, claimed_score, nonce, wallet_address } = sub;
  return canonicalBytes({ job_id, candidate_b64, claimed_score, nonce, wallet_address });
}
