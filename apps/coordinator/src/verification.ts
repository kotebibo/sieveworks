import { randomInt } from "node:crypto";
import {
  fromHex,
  verifyProof,
  type BucketLeaf,
} from "@sieveworks/merkle";
import type {
  ChallengeResponse,
  ResultSubmission,
  SubmissionResponse,
} from "@sieveworks/protocol";
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
const CHALLENGE_BUCKETS = 8;
export const CHALLENGE_WINDOW_S = Number(process.env.CHALLENGE_WINDOW_S ?? 90);

export interface VerifyDeps {
  bucketPool: BucketPool;
  leases: LeaseStore;
}

interface SubmissionContext {
  chunkId: string;
  jobId: string;
  workerId: string;
  specHash: string;
  rangeStart: bigint;
  rangeEnd: bigint;
  bucketSize: number;
  params: Record<string, unknown>;
  pricePerChunk: string;
  currentRecordScore: bigint | null;
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
  const [prior] = await sql<{ n: number }[]>`
    select count(*)::int as n from results
    where worker_id = ${ctx.workerId} and id != ${resultId}
      and verification_state in ('passed', 'failed')`;
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
           j.current_record_score, j.worker_spec_hash, r.worker_id
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
    if (!verifyProof(leaf, proof, row.buckets_count, root)) {
      return fail(`leaf ${l.index} not in committed tree`);
    }
    // Truth: recompute the bucket with the same WASM the worker ran.
    const bStart = ctx.rangeStart + BigInt(l.index) * BigInt(ctx.bucketSize);
    const bEndRaw = bStart + BigInt(ctx.bucketSize);
    const bEnd = bEndRaw < ctx.rangeEnd ? bEndRaw : ctx.rangeEnd;
    const truth = await deps.bucketPool.evaluateBucket(ctx.specHash, bStart, bEnd, paramsJson);
    if (truth.maxScore !== leaf.maxScore || truth.maxSeed !== leaf.maxSeed) {
      return fail(
        `bucket ${l.index}: committed (${leaf.maxScore}, ${leaf.maxSeed}) but truth is (${truth.maxScore}, ${truth.maxSeed})`
      );
    }
  }

  await sql`update challenges set passed = true where id = ${row.challenge_id}`;
  const claimed = BigInt(row.extremum_score);
  const isRecord = ctx.currentRecordScore === null || claimed > ctx.currentRecordScore;
  const sub = {
    witness_seed: row.witness_seed,
    extremum_score: row.extremum_score,
  } as ResultSubmission;
  await acceptResult(deps, row.result_id, sub, ctx, isRecord);
  return "accepted";
}

/** Fail every challenge whose window expired without a response. A worker
 * that computed honestly but discarded its buckets is indistinguishable from
 * one that never computed them (spec §5). Called by the sweeper. */
export async function expireChallenges(deps: VerifyDeps): Promise<number> {
  const expired = await sql`
    select ch.id as challenge_id, r.id as result_id,
           c.id as chunk_id, c.range_start::text, c.range_end::text,
           j.id as job_id, j.bucket_size, j.params, j.price_per_chunk_lamports::text,
           j.current_record_score, j.worker_spec_hash, r.worker_id
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

  if (isRecord) {
    // Record path (§8.6): the witness was already deterministically
    // re-verified above and records force a 100% challenge. On-chain
    // attestation lands Day 4; the finds row is its off-chain mirror.
    const updated = await sql`
      update jobs set current_record_score = ${sub.extremum_score},
                      current_record_seed = ${sub.witness_seed}
      where id = ${ctx.jobId}
        and (current_record_score is null or current_record_score < ${sub.extremum_score})
      returning id`;
    if (updated.length > 0) {
      const inserted = await sql<{ id: string }[]>`
        insert into finds (job_id, worker_id, seed, score, is_record)
        values (${ctx.jobId}, ${ctx.workerId}, ${sub.witness_seed}, ${sub.extremum_score}, true)
        on conflict (job_id, seed) do nothing
        returning id`;
      events.emit("new_record", {
        job_id: ctx.jobId,
        score: sub.extremum_score,
        seed: sub.witness_seed,
      });
      const [finder] = await sql<{ wallet_address: string; payout_address: string | null }[]>`
        select wallet_address, payout_address from users where id = ${ctx.workerId}`;
      if (finder) {
        await notify(finder.wallet_address, "record_found", "You set a new record",
          `Score ${sub.extremum_score}, seed ${sub.witness_seed}. It's now the top find on this bounty.`,
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
            seed: BigInt(sub.witness_seed),
            score: BigInt(sub.extremum_score),
            finder: finderWallet,
          })
            .then(async (sig) => {
              if (!sig) return;
              await sql`update finds set tx_signature = ${sig}, attested_at = now() where id = ${findId}`;
              events.emit("find_attested", { job_id: ctx.jobId, seed: sub.witness_seed, tx_signature: sig });
            })
            .catch((err) => console.error(`[chain] record_find attestation failed for find ${findId}:`, err));
        }
      }
    }
  }

  // Bounty completion: when the last chunk is accepted, close the job and
  // notify the funder (fires once, on the open→closed transition).
  const [remaining] = await sql<{ n: number }[]>`
    select count(*)::int as n from chunks where job_id = ${ctx.jobId} and state <> 'accepted'`;
  if (remaining!.n === 0) {
    const closed = await sql<{ creator_id: string }[]>`
      update jobs set status = 'closed', closed_at = now()
      where id = ${ctx.jobId} and status = 'open' returning creator_id`;
    if (closed.length > 0) {
      const [creator] = await sql<{ wallet_address: string }[]>`select wallet_address from users where id = ${closed[0]!.creator_id}`;
      if (creator) {
        await notify(creator.wallet_address, "bounty_complete", "Your bounty is complete",
          `All chunks verified. Download the top-scoring results as CSV.`, `/bounties/${ctx.jobId}`);
      }
      events.emit("bounty_complete", { job_id: ctx.jobId });
    }
  }
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
