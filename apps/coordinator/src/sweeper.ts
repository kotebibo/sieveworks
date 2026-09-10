import { finalizePrizes } from "./candidates.js";
import { sql } from "./db.js";
import { events } from "./events.js";
import type { LeaseStore } from "./leases.js";
import { expireChallenges, expireDeliveries, slowLaneReaudit, type VerifyDeps } from "./verification.js";

/**
 * Lease reclaim. Postgres lease_expires_at is the truth (spec §7): expired
 * leases return to pending with attempts+1; a chunk that keeps dying
 * (attempts > 5) is quarantined — it usually crashes the worker.
 */
export function startSweeper(deps: VerifyDeps, intervalMs = 10_000): NodeJS.Timeout {
  const leases = deps.leases;
  let tickNo = 0;
  const tick = async (): Promise<void> => {
    tickNo++;
    // Slow lane: one full-chunk training replay at most every 6th tick
    // (~once a minute) — expensive by design, bounded by construction.
    if (tickNo % 6 === 0) {
      const caught = await slowLaneReaudit(deps).catch((e) => { console.error("slow-lane:", e); return 0; });
      if (caught > 0) console.warn("sweeper: slow-lane re-audit caught a diverged chain");
    }
    const expired = await expireChallenges(deps);
    if (expired > 0) console.log(`sweeper: expired ${expired} unanswered challenge(s)`);
    const undelivered = await expireDeliveries(deps);
    if (undelivered > 0) console.log(`sweeper: expired ${undelivered} undelivered output(s)`);
    const finalized = await finalizePrizes();
    if (finalized > 0) console.log(`sweeper: finalized ${finalized} prize bount(y/ies)`);
    const quarantined = await sql<{ id: string; job_id: string }[]>`
      update chunks set state = 'quarantined', leased_to = null, lease_nonce = null
      where state = 'leased' and lease_expires_at < now() and attempts >= 5
      returning id, job_id`;
    const reclaimed = await sql<{ id: string; job_id: string; attempts: number }[]>`
      update chunks set state = 'pending', leased_to = null, lease_nonce = null,
        lease_expires_at = null, leased_at = null, attempts = attempts + 1
      where state = 'leased' and lease_expires_at < now()
      returning id, job_id, attempts`;
    for (const c of quarantined) {
      await leases.clear(c.id);
      events.emit("chunk_quarantined", { chunk_id: c.id, job_id: c.job_id });
    }
    for (const c of reclaimed) {
      await leases.clear(c.id);
      events.emit("chunk_reclaimed", { chunk_id: c.id, job_id: c.job_id, attempts: c.attempts });
    }
    if (quarantined.length + reclaimed.length > 0) {
      console.log(`sweeper: reclaimed=${reclaimed.length} quarantined=${quarantined.length}`);
    }
  };
  return setInterval(() => void tick().catch((e) => console.error("sweeper:", e)), intervalMs);
}
