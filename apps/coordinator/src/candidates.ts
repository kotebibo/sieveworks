import { createHash } from "node:crypto";
import { verifyCandidateSignature, type CandidateSubmission } from "@sieveworks/protocol";
import { attestFind, chainEnabled } from "./chain.js";
import { BucketPool } from "./bucketPool.js";
import { sql } from "./db.js";
import { events } from "./events.js";
import { notify } from "./notifications.js";

/**
 * Prize-bounty candidate handling (Spec 02). Submissions are open (no
 * chunk/lease), verified IMMEDIATELY by one deterministic re-evaluation in a
 * DEDICATED pool — deliberately separate from the challenge-judging pool so
 * a submission burst can never starve paid-chunk verification
 * (adversarial-review fix). Queue is bounded; overflow → 429.
 */

const QUEUE_CAP = 64;

export const candidatePool = new BucketPool();
let inFlight = 0;

export function candidateQueueFull(): boolean {
  return inFlight >= QUEUE_CAP;
}

export interface CandidateVerdict {
  ok: boolean;
  code: number;
  body: Record<string, unknown>;
}

export async function submitCandidate(sub: CandidateSubmission): Promise<CandidateVerdict> {
  // Signature: worker key over canonical bytes (same identity model as
  // chunk results — no session needed, the key IS the identity).
  if (!verifyCandidateSignature(sub)) return { ok: false, code: 422, body: { error: "rejected" } };

  const [job] = await sql`
    select j.id, j.status, j.bounty_kind, j.deadline_at, j.params, j.worker_spec_hash,
           ws.supports_candidates
    from jobs j join worker_specs ws on ws.hash = j.worker_spec_hash
    where j.id = ${sub.job_id}`;
  if (!job) return { ok: false, code: 404, body: { error: "unknown job" } };
  if (job.bounty_kind !== "prize") return { ok: false, code: 409, body: { error: "not a prize bounty" } };
  if (job.status !== "open") return { ok: false, code: 409, body: { error: "bounty not open" } };
  if (job.deadline_at && new Date(job.deadline_at) <= new Date()) {
    return { ok: false, code: 409, body: { error: "deadline passed" } };
  }
  if (!job.supports_candidates) return { ok: false, code: 409, body: { error: "module takes no candidates" } };

  const candidate = new Uint8Array(Buffer.from(sub.candidate_b64, "base64"));
  if (candidate.length === 0 || candidate.length > 65536) {
    return { ok: false, code: 400, body: { error: "candidate size out of range" } };
  }

  const [worker] = await sql<{ id: string }[]>`
    insert into users (wallet_address) values (${sub.wallet_address})
    on conflict (wallet_address) do update set wallet_address = excluded.wallet_address
    returning id`;

  inFlight++;
  let verified: bigint;
  try {
    verified = await candidatePool.evaluateCandidate(
      job.worker_spec_hash,
      sub.candidate_b64,
      JSON.stringify(job.params)
    );
  } catch (err) {
    inFlight--;
    // Evaluation error (bad candidate/hostile input) — recorded as rejected.
    await sql`
      insert into candidate_submissions (job_id, worker_id, candidate, claimed_score, state, signature)
      values (${sub.job_id}, ${worker!.id}, ${Buffer.from(candidate)}, ${sub.claimed_score}, 'rejected', ${sub.signature})`;
    return { ok: false, code: 422, body: { error: "rejected" } };
  }
  inFlight--;

  const claimed = BigInt(sub.claimed_score);
  const state = verified === claimed ? "verified" : "rejected";
  await sql`
    insert into candidate_submissions (job_id, worker_id, candidate, claimed_score, verified_score, state, signature, verified_at)
    values (${sub.job_id}, ${worker!.id}, ${Buffer.from(candidate)}, ${sub.claimed_score},
            ${verified.toString()}, ${state}, ${sub.signature}, now())`;

  if (state === "verified") {
    events.emit("candidate_verified", { job_id: sub.job_id, score: verified.toString() });
    return { ok: true, code: 200, body: { verified_score: verified.toString(), state } };
  }
  // Opaque to the submitter beyond the state — consistent with rejection
  // policy (they still learn the true score; that's the honest eval-oracle
  // property, bounded by rate limits).
  return { ok: true, code: 200, body: { verified_score: verified.toString(), state } };
}

/** Deadline finalization — called by the sweeper. Winner = highest verified
 * score above threshold; tie → earliest submission (priority = first to the
 * mark). Award = one-shot earnings upsert; the EXISTING claim voucher flow
 * pays it. No winner → job closes, funder reclaims via close_job (wired
 * separately). */
export async function finalizePrizes(): Promise<number> {
  const due = await sql`
    select j.id, j.prize_lamports::text, j.threshold_score::text, j.creator_id
    from jobs j
    where j.bounty_kind = 'prize' and j.status = 'open'
      and j.deadline_at is not null and j.deadline_at <= now()`;
  for (const job of due) {
    const [winner] = await sql`
      select cs.id, cs.worker_id, cs.verified_score::text, cs.candidate, u.wallet_address, u.payout_address
      from candidate_submissions cs
      join users u on u.id = cs.worker_id
      where cs.job_id = ${job.id} and cs.state = 'verified'
        and cs.verified_score > ${job.threshold_score}
      order by cs.verified_score desc, cs.submitted_at asc
      limit 1`;
    if (winner) {
      await sql`
        insert into earnings (worker_id, job_id, cumulative_lamports)
        values (${winner.worker_id}, ${job.id}, ${job.prize_lamports})
        on conflict (worker_id, job_id)
        do update set cumulative_lamports = ${job.prize_lamports}, updated_at = now()`;
      await sql`
        update jobs set status = 'closed', closed_at = now(),
          prize_winner_id = ${winner.worker_id}, prize_awarded_at = now()
        where id = ${job.id}`;
      events.emit("prize_awarded", { job_id: job.id, score: winner.verified_score });
      await notify(winner.wallet_address, "prize_won", "You won the prize",
        `Your candidate scored ${winner.verified_score} — claim your prize from the account page.`,
        `/account`);
      // On-chain attribution: record_find with seed = first 8 bytes of the
      // winning candidate's sha256 (documented digest-as-seed convention).
      if (chainEnabled()) {
        const digest = createHash("sha256").update(new Uint8Array(winner.candidate)).digest();
        const seed = digest.readBigUInt64LE(0);
        const finderWallet = (winner.payout_address as string | null) ?? (winner.wallet_address as string);
        void attestFind({
          jobUuid: job.id as string,
          seed,
          score: BigInt(winner.verified_score),
          finder: finderWallet,
        }).catch((err) => console.error(`[chain] prize attestation failed for job ${job.id}:`, err));
      }
    } else {
      await sql`update jobs set status = 'closed', closed_at = now() where id = ${job.id}`;
      events.emit("prize_unclaimed", { job_id: job.id });
      const [creator] = await sql<{ wallet_address: string }[]>`
        select wallet_address from users where id = ${job.creator_id}`;
      if (creator) {
        await notify(creator.wallet_address, "prize_unclaimed", "No winner — reclaim your prize",
          "No verified candidate beat the threshold before the deadline. Your escrow can be reclaimed.",
          `/bounties/${job.id}`);
      }
    }
  }
  return due.length;
}
