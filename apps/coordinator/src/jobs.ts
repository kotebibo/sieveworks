import { randomBytes } from "node:crypto";
import { z } from "zod";
import { u64String } from "@sieveworks/protocol";
import { sql } from "./db.js";
import { registry } from "./moduleRegistry.js";

/**
 * Chunk sizing is DERIVED, never hardcoded (Day 2 rule): target a ~30s chunk
 * from the measured seeds/sec of this worker spec, rounded up to whole
 * buckets. Defaults reflect the Day 1 native measurement at radius 256
 * (~2.9-3.3k seeds/sec/core) → ~100k seeds per chunk.
 */
const DEFAULT_SEEDS_PER_SEC = 3333;
const DEFAULT_TARGET_SECONDS = 30;
const MAX_CHUNKS_PER_JOB = 20_000;

export const CreateJobRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  game: z.string().min(1).default("compute"),
  worker_spec_hash: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex of a registered module"),
  params: z.record(z.string(), z.unknown()),
  version_pin: z.string().min(1).default("v1"),
  search_space_start: u64String,
  search_space_end: u64String,
  bucket_size: z.number().int().min(1).max(1_048_576).default(1024),
  target_chunk_seconds: z.number().int().min(5).max(600).default(DEFAULT_TARGET_SECONDS),
  seeds_per_sec: z.number().int().min(1).default(DEFAULT_SEEDS_PER_SEC),
  budget_lamports: z.coerce.bigint().nonnegative().default(0n),
  price_per_chunk_lamports: z.coerce.bigint().nonnegative().default(0n),
  lease_ttl_seconds: z.number().int().min(30).max(3600).default(180),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequest>;

export function deriveChunkSize(req: {
  target_chunk_seconds: number;
  seeds_per_sec: number;
  bucket_size: number;
}): bigint {
  const targetSeeds = BigInt(req.target_chunk_seconds * req.seeds_per_sec);
  const bucket = BigInt(req.bucket_size);
  const buckets = (targetSeeds + bucket - 1n) / bucket;
  return (buckets > 0n ? buckets : 1n) * bucket;
}

const HONEYPOT_FRACTION = 0.1; // ~10% of chunks contain a known seed
const HONEYPOT_CAP = 200;

function randomSeedIn(start: bigint, end: bigint): bigint {
  const range = end - start;
  const raw = BigInt("0x" + randomBytes(8).toString("hex"));
  return start + (raw % range);
}

/** Precompute honeypots with the verifier itself (spec §2.3). Nothing is
 * injected into assignments — these are simply seeds we already know the
 * answer for. The table has no public read policy; secrecy IS the mechanism. */
async function generateHoneypots(
  specHash: string,
  jobId: string,
  start: bigint,
  end: bigint,
  chunkCount: number,
  params: Record<string, unknown>
): Promise<number> {
  const module = await registry.get(specHash);
  const count = Math.min(HONEYPOT_CAP, Math.max(1, Math.ceil(chunkCount * HONEYPOT_FRACTION)));
  const paramsJson = JSON.stringify(params);
  const rows: { job_id: string; seed: string; score: string }[] = [];
  const seen = new Set<string>();
  while (rows.length < count) {
    const seed = randomSeedIn(start, end);
    const key = seed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = module.evaluateSeed(seed, paramsJson);
    rows.push({ job_id: jobId, seed: key, score: score.toString() });
  }
  await sql`insert into honeypots ${sql(rows)} on conflict (job_id, seed) do nothing`;
  return rows.length;
}

export async function createJob(
  req: CreateJobRequest,
  creatorWallet = "coordinator-admin"
): Promise<{ jobId: string; chunkSize: bigint; chunkCount: number; honeypots: number }> {
  const workerSpecHash = req.worker_spec_hash;
  const start = BigInt(req.search_space_start);
  const end = BigInt(req.search_space_end);
  if (end <= start) throw new Error("empty search space");

  const chunkSize = deriveChunkSize(req);
  const chunkCount = Number((end - start + chunkSize - 1n) / chunkSize);
  if (chunkCount > MAX_CHUNKS_PER_JOB) {
    throw new Error(
      `search space needs ${chunkCount} chunks (max ${MAX_CHUNKS_PER_JOB}); shrink the space or raise target_chunk_seconds`
    );
  }

  // The creator is the authenticated wallet (or coordinator-admin for the
  // token-gated admin path). Its user row must exist.
  const [creator] = await sql<{ id: string }[]>`
    insert into users (wallet_address)
    values (${creatorWallet})
    on conflict (wallet_address) do update set wallet_address = excluded.wallet_address
    returning id`;

  const [job] = await sql<{ id: string }[]>`
    insert into jobs (creator_id, title, description, game, worker_spec_hash, version_pin,
                      params, search_space_start, search_space_end, chunk_size, bucket_size,
                      budget_lamports, price_per_chunk_lamports, status, lease_ttl_seconds)
    values (${creator!.id}, ${req.title}, ${req.description ?? null}, ${req.game},
            ${workerSpecHash}, ${req.version_pin}, ${sql.json(req.params as never)},
            ${start.toString()}, ${end.toString()}, ${chunkSize.toString()}, ${req.bucket_size},
            ${req.budget_lamports.toString()}, ${req.price_per_chunk_lamports.toString()},
            'open', ${req.lease_ttl_seconds})
    returning id`;
  const jobId = job!.id;

  // Batched inserts; ascending ranges so allocation order = visual order.
  const BATCH = 1000;
  let rows: { job_id: string; range_start: string; range_end: string }[] = [];
  for (let s = start; s < end; s += chunkSize) {
    const e = s + chunkSize < end ? s + chunkSize : end;
    rows.push({ job_id: jobId, range_start: s.toString(), range_end: e.toString() });
    if (rows.length === BATCH) {
      await sql`insert into chunks ${sql(rows)}`;
      rows = [];
    }
  }
  if (rows.length > 0) await sql`insert into chunks ${sql(rows)}`;

  const honeypots = await generateHoneypots(workerSpecHash, jobId, start, end, chunkCount, req.params);

  return { jobId, chunkSize, chunkCount, honeypots };
}
