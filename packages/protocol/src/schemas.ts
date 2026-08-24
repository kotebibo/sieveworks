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

/** Worker → coordinator. `signature` is the worker wallet's ed25519 signature
 * over canonicalBytes of every other field (see resultSigningBytes). */
export const ResultSubmission = z.object({
  chunk_id: uuid,
  worker_spec_hash: sha256Hex,
  extremum_score: i64String,
  witness_seed: u64String,
  merkle_root: sha256Hex,
  buckets_count: z.number().int().positive(),
  seeds_evaluated: u64String,
  duration_ms: z.number().int().nonnegative(),
  nonce: z.string().min(16).max(128),
  signature: base58Sig,
});
export type ResultSubmission = z.infer<typeof ResultSubmission>;

/** The exact bytes a worker signs and the coordinator verifies. */
export function resultSigningBytes(submission: Omit<ResultSubmission, "signature">): Uint8Array {
  const { chunk_id, worker_spec_hash, extremum_score, witness_seed, merkle_root, buckets_count, seeds_evaluated, duration_ms, nonce } = submission;
  return canonicalBytes({ chunk_id, worker_spec_hash, extremum_score, witness_seed, merkle_root, buckets_count, seeds_evaluated, duration_ms, nonce });
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

/** WASM exports every conforming worker module must provide. Enforced by
 * wasm-runtime at load time. evaluate_seed is the verification primitive. */
export const WORKER_ABI = ["evaluate_range", "evaluate_seed", "spec_version"] as const;
