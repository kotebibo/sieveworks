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
  // ---- job creation (open: anyone can post against a registered module) ---
  app.post("/v1/jobs", async (req, reply) => {
    const parsed = CreateJobRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const [spec] = await sql`select hash from worker_specs where hash = ${parsed.data.worker_spec_hash}`;
    if (!spec) return reply.code(400).send({ error: "unknown worker_spec_hash — upload/register the module first" });
    const result = await createJob(parsed.data);
    events.emit("job_created", { job_id: result.jobId });
    return {
      job_id: result.jobId,
      worker_spec_hash: parsed.data.worker_spec_hash,
      chunk_size: result.chunkSize.toString(),
      chunk_count: result.chunkCount,
      honeypots: result.honeypots,
    };
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
  app.get("/v1/specs", async () => {
    const specs = await sql`
      select ws.hash, ws.name, ws.description, ws.spec_version, ws.conformance,
             ws.example_params, ws.default_range_start::text, ws.default_range_end::text,
             ws.is_builtin, ws.created_at,
             count(j.id) filter (where j.status = 'open')::int as open_jobs
      from worker_specs ws
      left join jobs j on j.worker_spec_hash = ws.hash
      group by ws.hash
      order by ws.is_builtin desc, ws.created_at asc`;
    return { specs };
  });

  // Serve any registered module's artifact by hash (workers fetch their job's
  // module; anyone can re-hash and re-verify it).
  app.get("/v1/specs/:hash/artifact", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    try {
      const bytes = await registry.getBytes(hash);
      reply.header("content-type", "application/wasm");
      reply.header("cache-control", "public, max-age=31536000, immutable");
      return reply.send(Buffer.from(bytes));
    } catch {
      return reply.code(404).send({ error: "unknown module" });
    }
  });

  // Upload a module → run the conformance gate → register on pass. This is the
  // self-serve platform surface: bring your own worker.
  app.post("/v1/specs", async (req, reply) => {
    const parts = req.parts();
    let wasm: Buffer | null = null;
    let name = "", description = "", exampleParams = "{}";
    for await (const part of parts) {
      if (part.type === "file") wasm = await part.toBuffer();
      else if (part.fieldname === "name") name = String(part.value).slice(0, 120);
      else if (part.fieldname === "description") description = String(part.value).slice(0, 2000);
      else if (part.fieldname === "example_params") exampleParams = String(part.value).slice(0, 4000);
    }
    if (!wasm || wasm.length === 0) return reply.code(400).send({ error: "no .wasm file" });
    if (wasm.length > 8 * 1024 * 1024) return reply.code(400).send({ error: "module too large (8MB max)" });
    if (!name) return reply.code(400).send({ error: "name required" });
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(exampleParams); } catch { return reply.code(400).send({ error: "example_params must be JSON" }); }

    const bytes = new Uint8Array(wasm);
    const verdict = await runConformanceGate(bytes, JSON.stringify(params));
    if (!verdict.ok) return reply.code(422).send({ ok: false, hash: verdict.hash, reason: verdict.reason });

    await sql`
      insert into worker_specs (hash, name, description, spec_version, wasm, conformance, example_params, is_builtin)
      values (${verdict.hash}, ${name}, ${description || null}, ${verdict.spec_version ?? "unknown"},
              ${wasm}, ${sql.json({ passed: true, buckets_checked: verdict.buckets_checked, sample: verdict.sample } as never)},
              ${sql.json(params as never)}, false)
      on conflict (hash) do update set name = excluded.name, description = excluded.description`;
    events.emit("spec_registered", { hash: verdict.hash, name });
    return { ok: true, hash: verdict.hash, spec_version: verdict.spec_version, conformance: verdict };
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
    const [job] = await sql`select * from jobs where id = ${id}`;
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
    const leaders = await sql`
      select u.wallet_address,
             count(r.id) filter (where r.verification_state = 'passed')::int as chunks,
             count(f.id)::int as finds,
             coalesce(sum(e.cumulative_lamports), 0)::text as earned_lamports
      from users u
      left join results r on r.worker_id = u.id
      left join finds f on f.worker_id = u.id
      left join earnings e on e.worker_id = u.id
      where u.wallet_address not in ('coordinator-admin')
      group by u.id
      having count(r.id) filter (where r.verification_state = 'passed') > 0
      order by chunks desc
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

