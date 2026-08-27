import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ChallengeResponse,
  ChunkAssignment,
  ResultSubmission,
  verifyResultSignature,
} from "@sieveworks/protocol";
import type { BucketPool } from "./bucketPool.js";
import { sql } from "./db.js";
import { events } from "./events.js";
import { createJob, CreateJobRequest } from "./jobs.js";
import type { LeaseStore } from "./leases.js";
import { env } from "./env.js";
import { judgeChallengeResponse, verifySubmission } from "./verification.js";
import { registry } from "./moduleRegistry.js";
import { runConformanceGate } from "./conformance.js";
import { authedWallet, completeSignIn, issueNonce, requireAuth } from "./auth.js";
import { notify } from "./notifications.js";
import { Transaction } from "@solana/web3.js";
import {
  chainEnabled,
  coSignAndSendClaim,
  coordinatorPubkey,
  expectedClaimIx,
  fetchJobEscrow,
  getChainInfo,
} from "./chain.js";

const LeaseRequest = z.object({
  job_id: z.uuid(),
  wallet_address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "base58 wallet"),
  payout_address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional(),
});

interface Deps {
  leases: LeaseStore;
  bucketPool: BucketPool;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  // ---- auth: Sign-In With Solana -----------------------------------------
  app.post("/v1/auth/nonce", async (req, reply) => {
    const { wallet } = (req.body ?? {}) as { wallet?: string };
    if (!wallet) return reply.code(400).send({ error: "wallet required" });
    const challenge = await issueNonce(wallet);
    if (!challenge) return reply.code(400).send({ error: "invalid wallet" });
    return challenge; // { nonce, message } — client signs `message`
  });

  app.post("/v1/auth/verify", async (req, reply) => {
    const { wallet, message, signature } = (req.body ?? {}) as { wallet?: string; message?: string; signature?: string };
    if (!wallet || !message || !signature) return reply.code(400).send({ error: "wallet, message, signature required" });
    const token = await completeSignIn(wallet, message, signature);
    if (!token) return reply.code(401).send({ error: "signature invalid or nonce expired" });
    return { token, wallet };
  });

  // ---- profile (email for notifications) ---------------------------------
  app.get("/v1/me", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    const [u] = await sql`
      select wallet_address, display_name, email, notify_prefs, created_at
      from users where wallet_address = ${wallet}`;
    const [counts] = await sql`
      select count(*) filter (where not read)::int as unread from notifications where wallet = ${wallet}`;
    return { user: u, unread: counts?.unread ?? 0 };
  });

  app.put("/v1/me", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    const body = (req.body ?? {}) as { email?: string | null; display_name?: string; notify_prefs?: Record<string, boolean> };
    const email = body.email?.trim() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: "invalid email" });
    await sql`
      update users set
        email = ${email},
        display_name = coalesce(${body.display_name ?? null}, display_name),
        notify_prefs = coalesce(${body.notify_prefs ? sql.json(body.notify_prefs as never) : null}, notify_prefs)
      where wallet_address = ${wallet}`;
    return { ok: true };
  });

  app.get("/v1/me/notifications", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    const items = await sql`
      select id, kind, title, body, link, read, created_at
      from notifications where wallet = ${wallet} order by created_at desc limit 50`;
    await sql`update notifications set read = true where wallet = ${wallet} and not read`;
    return { notifications: items };
  });

  // ---- job creation (requires sign-in; creator = authed wallet) ----------
  app.post("/v1/jobs", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    const parsed = CreateJobRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const [spec] = await sql`select hash from worker_specs where hash = ${parsed.data.worker_spec_hash}`;
    if (!spec) return reply.code(400).send({ error: "unknown worker_spec_hash — upload/register the module first" });
    const result = await createJob(parsed.data, wallet);
    events.emit("job_created", { job_id: result.jobId });
    return {
      job_id: result.jobId,
      worker_spec_hash: parsed.data.worker_spec_hash,
      chunk_size: result.chunkSize.toString(),
      chunk_count: result.chunkCount,
      honeypots: result.honeypots,
      status: result.status,
    };
  });

  // ---- on-chain settlement (devnet) --------------------------------------
  // What the frontend needs to build chain transactions: the program id and
  // the coordinator authority each escrow must register.
  app.get("/v1/chain", async () => getChainInfo());

  // Funder reports their initialize_job landed. We don't trust the report:
  // we fetch the escrow PDA from the chain and check funder/budget/price/
  // coordinator against our own job row before opening the job.
  app.post("/v1/jobs/:id/funded", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    const { id } = req.params as { id: string };
    const { signature } = (req.body ?? {}) as { signature?: string };
    if (!signature) return reply.code(400).send({ error: "signature required" });

    const [job] = await sql<{ status: string; budget_lamports: string; price_per_chunk_lamports: string; creator_wallet: string }[]>`
      select j.status, j.budget_lamports::text, j.price_per_chunk_lamports::text, u.wallet_address as creator_wallet
      from jobs j join users u on u.id = j.creator_id where j.id = ${id}`;
    if (!job) return reply.code(404).send({ error: "unknown job" });
    if (job.creator_wallet !== wallet) return reply.code(403).send({ error: "not your job" });
    if (job.status === "open") return { ok: true, status: "open", note: "already funded" };
    if (job.status !== "draft") return reply.code(409).send({ error: `job is ${job.status}` });

    const escrow = await fetchJobEscrow(id);
    if (!escrow) return reply.code(409).send({ error: "escrow not found on-chain yet — wait for confirmation and retry" });
    const coordinator = coordinatorPubkey();
    if (!coordinator || escrow.coordinator.toBase58() !== coordinator.toBase58()) {
      return reply.code(409).send({ error: "escrow registered a different coordinator authority" });
    }
    if (escrow.funder.toBase58() !== wallet) {
      return reply.code(409).send({ error: "escrow funded by a different wallet" });
    }
    if (escrow.budget < BigInt(job.budget_lamports) || escrow.pricePerChunk !== BigInt(job.price_per_chunk_lamports)) {
      return reply.code(409).send({ error: "escrow budget/price does not match the job" });
    }

    await sql`update jobs set status = 'open', funding_signature = ${signature}, funded_at = now() where id = ${id}`;
    events.emit("job_created", { job_id: id }); // job becomes visible/leasable now
    return { ok: true, status: "open" };
  });

  // Claimable earnings for the authed wallet, per job. Earnings accrue to
  // worker rows (local browser keys); a wallet claims the sum over every
  // worker row it owns — its own row plus rows whose payout_address is it.
  app.get("/v1/claims", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    const rows = await sql`
      select e.job_id, j.title, j.status,
             sum(e.cumulative_lamports)::text as cumulative_lamports,
             sum(e.claimed_lamports)::text as claimed_lamports,
             max(e.last_voucher_nonce)::text as last_nonce
      from earnings e
      join users u on u.id = e.worker_id
      join jobs j on j.id = e.job_id
      where (u.wallet_address = ${wallet} or u.payout_address = ${wallet})
        and j.price_per_chunk_lamports > 0
      group by e.job_id, j.title, j.status
      order by max(e.updated_at) desc`;
    return { claims: rows, chain: getChainInfo() };
  });

  // Voucher: what the coordinator will co-sign right now for (wallet, job).
  // The browser builds the claim tx from exactly these numbers.
  app.get("/v1/claims/:jobId/voucher", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    if (!chainEnabled()) return reply.code(503).send({ error: "chain rail disabled" });
    const { jobId } = req.params as { jobId: string };
    const [row] = await sql<{ cumulative: string }[]>`
      select coalesce(sum(e.cumulative_lamports), 0)::text as cumulative
      from earnings e join users u on u.id = e.worker_id
      where e.job_id = ${jobId} and (u.wallet_address = ${wallet} or u.payout_address = ${wallet})`;
    const cumulative = BigInt(row?.cumulative ?? "0");
    if (cumulative <= 0n) return reply.code(400).send({ error: "nothing to claim" });
    return {
      job_id: jobId,
      worker: wallet,
      cumulative_lamports: cumulative.toString(),
      nonce: Date.now().toString(),
      ...getChainInfo(),
    };
  });

  // The worker built + signed the claim tx from a voucher; we verify it is
  // EXACTLY the instruction we'd authorize (byte-equal data, same accounts),
  // then co-sign and submit. The program's cumulative arithmetic makes any
  // replay pay zero, so the worst a stale voucher does is nothing.
  app.post("/v1/claims/:jobId", async (req, reply) => {
    const wallet = requireAuth(req, reply);
    if (!wallet) return;
    if (!chainEnabled()) return reply.code(503).send({ error: "chain rail disabled" });
    const { jobId } = req.params as { jobId: string };
    const { tx: txB64 } = (req.body ?? {}) as { tx?: string };
    if (!txB64) return reply.code(400).send({ error: "tx required (base64)" });

    let tx: Transaction;
    try {
      tx = Transaction.from(Buffer.from(txB64, "base64"));
    } catch {
      return reply.code(400).send({ error: "malformed transaction" });
    }
    if (tx.instructions.length !== 1) return reply.code(400).send({ error: "expected exactly one instruction" });
    const ix = tx.instructions[0]!;

    // Recompute what we're willing to authorize and parse what they sent.
    const [row] = await sql<{ cumulative: string; last_nonce: string }[]>`
      select coalesce(sum(e.cumulative_lamports), 0)::text as cumulative,
             coalesce(max(e.last_voucher_nonce), 0)::text as last_nonce
      from earnings e join users u on u.id = e.worker_id
      where e.job_id = ${jobId} and (u.wallet_address = ${wallet} or u.payout_address = ${wallet})`;
    const maxCumulative = BigInt(row?.cumulative ?? "0");
    const data = ix.data;
    if (data.length !== 8 + 16 + 8 + 8) return reply.code(400).send({ error: "unexpected instruction size" });
    const claimed = data.readBigUInt64LE(24);
    const nonce = data.readBigUInt64LE(32);
    if (claimed > maxCumulative) return reply.code(400).send({ error: "claim exceeds accrued earnings" });
    if (nonce <= BigInt(row?.last_nonce ?? "0")) return reply.code(400).send({ error: "stale voucher nonce" });

    // Byte-exact check against the instruction we'd build ourselves — same
    // discriminator, job id, amounts, and the same five accounts in order.
    const expected = expectedClaimIx({ jobUuid: jobId, worker: wallet, cumulativeLamports: claimed, nonce });
    if (!ix.programId.equals(expected.programId) || Buffer.compare(data, expected.data) !== 0) {
      return reply.code(400).send({ error: "instruction does not match voucher" });
    }
    if (ix.keys.length !== expected.keys.length ||
        !ix.keys.every((k, i) => k.pubkey.equals(expected.keys[i]!.pubkey)
          && k.isSigner === expected.keys[i]!.isSigner && k.isWritable === expected.keys[i]!.isWritable)) {
      return reply.code(400).send({ error: "accounts do not match voucher" });
    }
    if (!tx.feePayer?.equals(expected.keys[0]!.pubkey)) return reply.code(400).send({ error: "fee payer must be the worker" });

    try {
      const sig = await coSignAndSendClaim(Buffer.from(txB64, "base64"));
      await sql`
        update earnings e set claimed_lamports = e.cumulative_lamports,
                              last_voucher_nonce = ${nonce.toString()},
                              last_voucher_sig = ${sig},
                              updated_at = now()
        from users u
        where u.id = e.worker_id and e.job_id = ${jobId}
          and (u.wallet_address = ${wallet} or u.payout_address = ${wallet})`;
      return { ok: true, signature: sig };
    } catch (err) {
      return reply.code(502).send({ error: `claim failed on-chain: ${String(err)}` });
    }
  });

  // admin alias (kept for scripts) — same handler, token-gated
  app.post("/admin/jobs", async (req, reply) => {
    if (req.headers["x-admin-token"] !== env.ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
    const parsed = CreateJobRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const [spec] = await sql`select hash from worker_specs where hash = ${parsed.data.worker_spec_hash}`;
    if (!spec) return reply.code(400).send({ error: "unknown worker_spec_hash" });
    const result = await createJob(parsed.data);
    events.emit("job_created", { job_id: result.jobId });
    return { job_id: result.jobId, worker_spec_hash: parsed.data.worker_spec_hash, chunk_size: result.chunkSize.toString(), chunk_count: result.chunkCount, honeypots: result.honeypots };
  });

  // ---- worker module registry --------------------------------------------
  // Optionally authed: everyone sees public + built-in modules; a signed-in
  // caller ALSO sees their own private modules. `mine` marks the caller's.
  app.get("/v1/specs", async (req) => {
    const caller = authedWallet(req);
    const specs = await sql`
      select ws.hash, ws.name, ws.description, ws.spec_version, ws.conformance,
             ws.example_params, ws.default_range_start::text, ws.default_range_end::text,
             ws.is_builtin, ws.is_private, ws.publisher, ws.created_at,
             (ws.publisher is not null and ws.publisher = ${caller}) as mine,
             count(j.id) filter (where j.status = 'open')::int as open_jobs
      from worker_specs ws
      left join jobs j on j.worker_spec_hash = ws.hash
      where ws.is_private = false or ws.publisher = ${caller}
      group by ws.hash
      order by ws.is_builtin desc, ws.created_at asc`;
    return { specs };
  });

  // Serve a registered module's artifact by hash. Public/built-in modules are
  // open (anyone can re-hash and re-verify). A PRIVATE module's bytes are
  // owner-only — UNLESS a job already pins it, in which case contributors on
  // that job must be able to fetch it to run the work.
  app.get("/v1/specs/:hash/artifact", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const [meta] = await sql<{ is_private: boolean; publisher: string | null }[]>`
      select is_private, publisher from worker_specs where hash = ${hash}`;
    if (!meta) return reply.code(404).send({ error: "unknown module" });
    if (meta.is_private) {
      const caller = authedWallet(req);
      const isOwner = caller !== null && caller === meta.publisher;
      let hasJob = false;
      if (!isOwner) {
        const [j] = await sql<{ n: number }[]>`
          select count(*)::int as n from jobs where worker_spec_hash = ${hash}`;
        hasJob = (j?.n ?? 0) > 0;
      }
      if (!isOwner && !hasJob) return reply.code(403).send({ error: "private module" });
    }
    try {
      const bytes = await registry.getBytes(hash);
      reply.header("content-type", "application/wasm");
      reply.header("cache-control", meta.is_private ? "private, max-age=0" : "public, max-age=31536000, immutable");
      return reply.send(Buffer.from(bytes));
    } catch {
      return reply.code(404).send({ error: "unknown module" });
    }
  });

  // Publisher toggles a module's visibility (public ↔ private). Owner-only;
  // built-ins can't be made private.
  app.patch("/v1/specs/:hash", async (req, reply) => {
    const caller = requireAuth(req, reply);
    if (!caller) return;
    const { hash } = req.params as { hash: string };
    const body = (req.body ?? {}) as { is_private?: boolean };
    if (typeof body.is_private !== "boolean") return reply.code(400).send({ error: "is_private (boolean) required" });
    const [row] = await sql<{ publisher: string | null; is_builtin: boolean }[]>`
      select publisher, is_builtin from worker_specs where hash = ${hash}`;
    if (!row) return reply.code(404).send({ error: "unknown module" });
    if (row.is_builtin) return reply.code(403).send({ error: "built-in modules are public" });
    if (row.publisher !== caller) return reply.code(403).send({ error: "not your module" });
    await sql`update worker_specs set is_private = ${body.is_private} where hash = ${hash}`;
    return { ok: true, hash, is_private: body.is_private };
  });

  // Upload a module → run the conformance gate → register on pass. This is the
  // self-serve platform surface: bring your own worker. Requires sign-in; the
  // authed wallet becomes the module's publisher.
  app.post("/v1/specs", async (req, reply) => {
    const publisher = requireAuth(req, reply);
    if (!publisher) return;
    const parts = req.parts();
    let wasm: Buffer | null = null;
    let name = "", description = "", exampleParams = "{}", isPrivate = false;
    for await (const part of parts) {
      if (part.type === "file") wasm = await part.toBuffer();
      else if (part.fieldname === "name") name = String(part.value).slice(0, 120);
      else if (part.fieldname === "description") description = String(part.value).slice(0, 2000);
      else if (part.fieldname === "example_params") exampleParams = String(part.value).slice(0, 4000);
      else if (part.fieldname === "visibility") isPrivate = String(part.value) === "private";
    }
    if (!wasm || wasm.length === 0) return reply.code(400).send({ error: "no .wasm file" });
    if (wasm.length > 8 * 1024 * 1024) return reply.code(400).send({ error: "module too large (8MB max)" });
    if (!name) return reply.code(400).send({ error: "name required" });
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(exampleParams); } catch { return reply.code(400).send({ error: "example_params must be JSON" }); }

    const bytes = new Uint8Array(wasm);
    const verdict = await runConformanceGate(bytes, JSON.stringify(params));
    if (!verdict.ok) return reply.code(422).send({ ok: false, hash: verdict.hash, reason: verdict.reason });

    // Content-addressed: identical bytes = same module. Only the ORIGINAL
    // publisher may update its metadata — a later uploader of the same hash
    // can't rename someone else's module.
    const [existing] = await sql<{ publisher: string | null; is_builtin: boolean }[]>`
      select publisher, is_builtin from worker_specs where hash = ${verdict.hash}`;
    if (existing && (existing.is_builtin || (existing.publisher && existing.publisher !== publisher))) {
      return reply.code(200).send({ ok: true, hash: verdict.hash, spec_version: verdict.spec_version, note: "already registered by another publisher; metadata unchanged" });
    }
    await sql`
      insert into worker_specs (hash, name, description, spec_version, wasm, conformance, example_params, is_builtin, is_private, publisher)
      values (${verdict.hash}, ${name}, ${description || null}, ${verdict.spec_version ?? "unknown"},
              ${wasm}, ${sql.json({ passed: true, buckets_checked: verdict.buckets_checked, sample: verdict.sample } as never)},
              ${sql.json(params as never)}, false, ${isPrivate}, ${publisher})
      on conflict (hash) do update set name = excluded.name, description = excluded.description, is_private = ${isPrivate}, publisher = ${publisher}`;
    await notify(publisher, "module_registered", `Module "${name}" registered`, `Your worker module passed the conformance gate and is ${isPrivate ? "private (visible only to you)" : "live"}.`, "/modules");
    events.emit("spec_registered", { hash: verdict.hash, name });
    return { ok: true, hash: verdict.hash, spec_version: verdict.spec_version, is_private: isPrivate, conformance: verdict };
  });

  // ---- public reads ------------------------------------------------------
  app.get("/v1/jobs", async () => {
    const jobs = await sql`
      select j.id, j.title, j.game, j.status, j.worker_spec_hash, j.version_pin,
             j.bucket_size, j.chunk_size::text, j.price_per_chunk_lamports::text,
             count(c.id) filter (where c.state = 'pending') as pending_chunks,
             count(c.id) filter (where c.state = 'accepted') as accepted_chunks,
             count(c.id) as total_chunks
      from jobs j left join chunks c on c.job_id = j.id
      where j.status = 'open'
      group by j.id
      order by j.created_at desc`;
    return { jobs };
  });

  app.get("/v1/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [job] = await sql`
      select j.*, u.wallet_address as creator_wallet
      from jobs j join users u on u.id = j.creator_id
      where j.id = ${id}`;
    if (!job) return reply.code(404).send({ error: "not found" });
    const states = await sql`
      select state, count(*)::int as n from chunks where job_id = ${id} group by state`;
    return { job, chunk_states: Object.fromEntries(states.map((r) => [r.state, r.n])) };
  });

  app.get("/v1/jobs/:id/results", async (req) => {
    const { id } = req.params as { id: string };
    const results = await sql`
      select r.id, r.extremum_score::text, r.witness_seed::text, r.merkle_root,
             r.duration_ms, r.verification_state, r.submitted_at,
             c.range_start::text, c.range_end::text, u.wallet_address
      from results r
      join chunks c on c.id = r.chunk_id
      join users u on u.id = r.worker_id
      where c.job_id = ${id}
      order by r.submitted_at desc
      limit 50`;
    return { results };
  });

  // Downsampled per-chunk state for the swarm grid, ordered by range so the
  // grid fills contiguously. One char per chunk: a/p/l/s/v/r/q.
  app.get("/v1/jobs/:id/swarm", async (req) => {
    const { id } = req.params as { id: string };
    const rows = await sql<{ state: string }[]>`
      select state from chunks where job_id = ${id} order by range_start asc limit 2000`;
    const code: Record<string, string> = {
      accepted: "a", pending: "p", leased: "l", submitted: "s",
      verifying: "v", challenged: "v", rejected: "r", quarantined: "q",
    };
    return { cells: rows.map((r) => code[r.state] ?? "p").join("") };
  });

  // The single most active open job — powers the landing hero swarm.
  app.get("/v1/swarm", async () => {
    const [job] = await sql<{ id: string; title: string }[]>`
      select j.id, j.title from jobs j
      join chunks c on c.job_id = j.id
      where j.status = 'open'
      group by j.id
      order by count(c.id) filter (where c.state in ('leased','submitted','verifying')) desc,
               count(c.id) filter (where c.state = 'accepted') desc
      limit 1`;
    if (!job) return { job_id: null, title: null, cells: "" };
    const rows = await sql<{ state: string }[]>`
      select state from chunks where job_id = ${job.id} order by range_start asc limit 2000`;
    const code: Record<string, string> = {
      accepted: "a", pending: "p", leased: "l", submitted: "s",
      verifying: "v", challenged: "v", rejected: "r", quarantined: "q",
    };
    return { job_id: job.id, title: job.title, cells: rows.map((r) => code[r.state] ?? "p").join("") };
  });

  app.get("/v1/finds", async () => {
    const finds = await sql`
      select f.id, f.seed::text, f.score::text, f.is_record, f.tx_signature, f.created_at,
             j.title as job_title, j.id as job_id, u.wallet_address
      from finds f
      join jobs j on j.id = f.job_id
      join users u on u.id = f.worker_id
      order by f.created_at desc
      limit 100`;
    return { finds };
  });

  app.get("/v1/leaderboard", async () => {
    // Subqueries, not multi-join: joining results × finds × earnings would
    // fan out into a cartesian product and inflate every count.
    const leaders = await sql`
      select * from (
        select u.wallet_address,
               (select count(*) from results r where r.worker_id = u.id and r.verification_state = 'passed')::int as chunks,
               (select count(*) from finds f where f.worker_id = u.id)::int as finds,
               (select coalesce(sum(cumulative_lamports), 0) from earnings e where e.worker_id = u.id)::text as earned_lamports
        from users u
        where u.wallet_address <> 'coordinator-admin'
      ) t
      where t.chunks > 0
      order by t.chunks desc
      limit 50`;
    return { leaders };
  });

  app.get("/v1/workers/:wallet", async (req, reply) => {
    const { wallet } = req.params as { wallet: string };
    const [u] = await sql`select id, wallet_address, created_at from users where wallet_address = ${wallet}`;
    if (!u) return reply.code(404).send({ error: "not found" });
    const [agg] = await sql`
      select count(r.id) filter (where r.verification_state = 'passed')::int as chunks,
             count(r.id) filter (where r.verification_state = 'failed')::int as rejected,
             coalesce(sum(r.seeds_evaluated) filter (where r.verification_state = 'passed'), 0)::text as seeds,
             (select count(*) from finds where worker_id = ${u.id})::int as finds,
             (select coalesce(sum(cumulative_lamports),0) from earnings where worker_id = ${u.id})::text as earned
      from results r where r.worker_id = ${u.id}`;
    const recentFinds = await sql`
      select seed::text, score::text, is_record, job_id, created_at
      from finds where worker_id = ${u.id} order by created_at desc limit 20`;
    return { worker: u, stats: agg, finds: recentFinds };
  });

  // Results delivery for the funder: the top-scoring verified seeds across the
  // whole search (one row per chunk-best), ranked, as a downloadable CSV.
  app.get("/v1/jobs/:id/results.csv", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(10000, Math.max(1, Number(q.limit ?? 100) || 100));
    const [job] = await sql<{ title: string }[]>`select title from jobs where id = ${id}`;
    if (!job) return reply.code(404).send({ error: "not found" });
    const rows = await sql<{ score: string; seed: string; wallet: string; verified_at: string }[]>`
      select r.extremum_score::text as score, r.witness_seed::text as seed,
             u.wallet_address as wallet,
             to_char(r.verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as verified_at
      from results r
      join chunks c on c.id = r.chunk_id
      join users u on u.id = r.worker_id
      where c.job_id = ${id} and r.verification_state = 'passed'
      order by r.extremum_score desc, r.witness_seed asc
      limit ${limit}`;
    const header = "rank,score,seed,finder_wallet,verified_at";
    const lines = rows.map((r, i) => `${i + 1},${r.score},${r.seed},${r.wallet},${r.verified_at ?? ""}`);
    const csv = [header, ...lines].join("\n") + "\n";
    const safe = job.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="sieveworks-${safe}-top${rows.length}.csv"`);
    return reply.send(csv);
  });

  app.get("/v1/stats", async () => {
    const [row] = await sql`
      select
        (select count(*) from jobs where status = 'open')::int as open_jobs,
        (select count(*) from chunks where state = 'accepted')::int as chunks_accepted,
        (select coalesce(sum(seeds_evaluated), 0) from results
           where verification_state = 'passed')::text as seeds_evaluated,
        (select count(distinct worker_id) from results)::int as contributors,
        (select count(*) from chunks where state = 'leased')::int as chunks_in_flight`;
    return { ...row, sse_clients: events.size };
  });

  // ---- lease -------------------------------------------------------------
  app.post("/v1/lease", async (req, reply) => {
    const parsed = LeaseRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const { job_id, wallet_address, payout_address } = parsed.data;

    const [job] = await sql`
      select id, worker_spec_hash, bucket_size, params, lease_ttl_seconds, status
      from jobs where id = ${job_id}`;
    if (!job || job.status !== "open") return reply.code(404).send({ error: "job not open" });

    const [worker] = await sql<{ id: string }[]>`
      insert into users (wallet_address, payout_address) values (${wallet_address}, ${payout_address ?? null})
      on conflict (wallet_address) do update set
        payout_address = coalesce(${payout_address ?? null}, users.payout_address)
      returning id`;

    const nonce = randomBytes(16).toString("hex");
    const ttl = job.lease_ttl_seconds as number;

    // SKIP LOCKED makes concurrent leases race-free; ascending range order
    // keeps swarm progress visually contiguous (spec §7).
    const [chunk] = await sql.begin(async (tx) => {
      const [c] = await tx`
        select id, range_start::text, range_end::text from chunks
        where job_id = ${job_id} and state = 'pending'
        order by range_start asc
        limit 1
        for update skip locked`;
      if (!c) return [];
      await tx`
        update chunks set state = 'leased', leased_to = ${worker!.id}, leased_at = now(),
          lease_expires_at = now() + make_interval(secs => ${ttl}),
          lease_nonce = ${nonce}
        where id = ${c.id}`;
      return [c];
    });
    if (!chunk) return reply.code(404).send({ error: "no pending chunks" });

    await deps.leases.set(chunk.id as string, nonce, ttl);

    const assignment = ChunkAssignment.parse({
      chunk_id: chunk.id,
      job_id,
      worker_spec_hash: job.worker_spec_hash,
      range_start: chunk.range_start,
      range_end: chunk.range_end,
      bucket_size: job.bucket_size,
      params: job.params,
      lease_expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      nonce,
    });
    events.emit("chunk_leased", { chunk_id: chunk.id, job_id, wallet: wallet_address });
    return assignment;
  });

  // ---- result submission -------------------------------------------------
  app.post("/v1/results", async (req, reply) => {
    const parsed = ResultSubmission.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const sub = parsed.data;

    const [row] = await sql`
      select c.id as chunk_id, c.state, c.lease_nonce, c.lease_expires_at, c.leased_to,
             c.range_start::text, c.range_end::text,
             j.id as job_id, j.worker_spec_hash, j.bucket_size, j.params,
             j.price_per_chunk_lamports::text, j.current_record_score,
             u.wallet_address
      from chunks c
      join jobs j on j.id = c.job_id
      left join users u on u.id = c.leased_to
      where c.id = ${sub.chunk_id}`;
    if (!row) return reply.code(404).send({ error: "unknown chunk" });

    // Spec §8 step 1 — protocol-validity rejections. No detail beyond the
    // category reaches the worker (rejection reasons are coordinator-only).
    if (row.state !== "leased") return reply.code(409).send({ error: "chunk not leased" });
    if (new Date(row.lease_expires_at) <= new Date())
      return reply.code(409).send({ error: "lease expired" });
    if (row.worker_spec_hash !== sub.worker_spec_hash)
      return reply.code(422).send({ error: "rejected" });
    if (row.lease_nonce !== sub.nonce) return reply.code(422).send({ error: "rejected" });
    if (!verifyResultSignature(sub, row.wallet_address))
      return reply.code(422).send({ error: "rejected" });

    const [result] = await sql<{ id: string }[]>`
      insert into results (chunk_id, worker_id, extremum_score, witness_seed, merkle_root,
                           buckets_count, seeds_evaluated, duration_ms, signature,
                           verification_state)
      values (${sub.chunk_id}, ${row.leased_to}, ${sub.extremum_score}, ${sub.witness_seed},
              ${sub.merkle_root}, ${sub.buckets_count}, ${sub.seeds_evaluated},
              ${sub.duration_ms}, ${sub.signature}, 'pending')
      returning id`;
    await sql`update chunks set state = 'submitted' where id = ${sub.chunk_id}`;
    events.emit("chunk_submitted", { chunk_id: sub.chunk_id, job_id: row.job_id });

    // The verification pipeline (spec §8): witness → honeypot → challenge.
    return verifySubmission(deps, result!.id, sub, {
      chunkId: sub.chunk_id,
      jobId: row.job_id,
      workerId: row.leased_to,
      specHash: row.worker_spec_hash,
      rangeStart: BigInt(row.range_start),
      rangeEnd: BigInt(row.range_end),
      bucketSize: row.bucket_size,
      params: row.params,
      pricePerChunk: row.price_per_chunk_lamports,
      currentRecordScore: row.current_record_score === null ? null : BigInt(row.current_record_score),
    });
  });

  // ---- challenge response ------------------------------------------------
  app.post("/v1/challenge-response", async (req, reply) => {
    const parsed = ChallengeResponse.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    try {
      const status = await judgeChallengeResponse(deps, parsed.data);
      return { result_id: parsed.data.result_id, status };
    } catch (err) {
      const code = (err as { code?: number }).code === 404 ? 404 : 500;
      return reply.code(code).send({ error: code === 404 ? "no open challenge" : "internal" });
    }
  });

  // ---- audit -------------------------------------------------------------
  // Everything a third party needs to independently re-verify a decision
  // (spec §8) — the honest answer to "your coordinator is centralized."
  // Honeypot coordinates stay redacted while the job is open; a mapped
  // honeypot is a dead honeypot. They unredact when the job closes.
  app.get("/v1/audit/results/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [r] = await sql`
      select r.*, r.extremum_score::text, r.witness_seed::text, r.seeds_evaluated::text,
             c.range_start::text, c.range_end::text, c.job_id,
             j.worker_spec_hash, j.version_pin, j.params, j.bucket_size, j.status as job_status,
             u.wallet_address
      from results r
      join chunks c on c.id = r.chunk_id
      join jobs j on j.id = c.job_id
      join users u on u.id = r.worker_id
      where r.id = ${id}`;
    if (!r) return reply.code(404).send({ error: "not found" });
    const challenges = await sql`
      select bucket_indices, response, passed, issued_at, responded_at
      from challenges where result_id = ${id} order by issued_at`;
    const [rejection] = await sql`
      select reason, detail, created_at from result_rejections where result_id = ${id}`;
    const jobOpen = r.job_status === "open";
    const redactedRejection =
      rejection && jobOpen && rejection.reason === "honeypot_failed"
        ? { ...rejection, detail: { redacted: "honeypot coordinates hidden until job closes" } }
        : rejection;
    return {
      result: r,
      challenges,
      rejection: redactedRejection ?? null,
      how_to_reverify: {
        witness: "evaluate_seed(witness_seed, params) with the wasm whose sha256 = worker_spec_hash; must equal extremum_score",
        challenge: "verify each leaf's inclusion proof against merkle_root, then evaluate_range over that bucket and compare",
        artifact: "GET /v1/specs/{worker_spec_hash}/artifact (hash-check it yourself)",
      },
    };
  });

  // ---- SSE ---------------------------------------------------------------
  app.get("/v1/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    reply.raw.write(`event: hello\ndata: {"service":"sieveworks-coordinator"}\n\n`);
    events.add(reply.raw);
  });
}

