import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  type BucketLeaf,
  hashLeaf,
  merkleRoot,
  toHex,
} from "@sieveworks/merkle";
import {
  ChunkAssignment,
  signResult,
  walletFromSecretKey,
  type UnsignedResult,
} from "@sieveworks/protocol";

/**
 * Native CLI worker: lease → evaluate via the native core → merkle commit →
 * sign → submit, in a loop until the job runs dry. Bucket data is retained
 * in memory so challenges (Day 3) can be answered after submission.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORE = join(
  here, "..", "..", "..", "packages", "worker-core", "out", "native",
  process.platform === "win32" ? "sieve_core.exe" : "sieve_core"
);

const { values: args } = parseArgs({
  options: {
    job: { type: "string" },
    wallet: { type: "string", default: "worker-wallet.json" },
    coordinator: { type: "string", default: "http://localhost:8080" },
    core: { type: "string", default: DEFAULT_CORE },
    "max-chunks": { type: "string" },
    keygen: { type: "boolean", default: false },
  },
});

if (args.keygen) {
  const secret = randomBytes(32);
  const wallet = walletFromSecretKey(secret);
  // Solana keypair file format: 64-byte array (seed ‖ pubkey-placeholder is
  // derived on load; we store seed twice-compatible via full expansion).
  writeFileSync(args.wallet!, JSON.stringify(Array.from(secret)));
  console.log(`wrote ${args.wallet}\nwallet: ${wallet}`);
  process.exit(0);
}

if (!args.job) {
  console.error("usage: sieveworks-worker --job <id> [--wallet keypair.json] [--coordinator url]");
  process.exit(2);
}
if (!existsSync(args.wallet!)) {
  console.error(`wallet file ${args.wallet} not found — run with --keygen first`);
  process.exit(2);
}

const secretKey = Uint8Array.from(JSON.parse(readFileSync(args.wallet!, "utf8")));
const wallet = walletFromSecretKey(secretKey);
const maxChunks = args["max-chunks"] ? Number(args["max-chunks"]) : Infinity;
console.log(`worker ${wallet} → ${args.coordinator} job ${args.job}`);

// chunk_id → bucket leaves, retained for future challenges
const retained = new Map<string, BucketLeaf[]>();
const RETAIN_MAX = 8;

async function api<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${args.coordinator}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

function evaluateChunk(a: ChunkAssignment): BucketLeaf[] {
  const paramsJson = JSON.stringify(a.params);
  const out = execFileSync(
    args.core!,
    ["eval-range", a.range_start, a.range_end, String(a.bucket_size), paramsJson],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return out
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [index, score, seed] = line.split(" ");
      return { index: Number(index), maxScore: BigInt(score!), maxSeed: BigInt(seed!) };
    });
}

let completed = 0;
while (completed < maxChunks) {
  const lease = await api<unknown>("/v1/lease", { job_id: args.job, wallet_address: wallet });
  if (lease.status === 404) {
    console.log(`no pending chunks — job drained. completed ${completed} chunk(s).`);
    break;
  }
  if (lease.status !== 200) {
    console.error(`lease failed (${lease.status}):`, lease.data);
    process.exit(1);
  }
  const assignment = ChunkAssignment.parse(lease.data);
  const t0 = Date.now();
  const leaves = evaluateChunk(assignment);
  const durationMs = Date.now() - t0;

  // Extremum fold: ascending, strictly greater — identical tie-breaking to
  // the C core (lowest seed wins). Protocol rule, do not change.
  let best = leaves[0]!;
  for (const leaf of leaves) {
    if (leaf.maxScore > best.maxScore) best = leaf;
  }
  const root = toHex(merkleRoot(leaves.map(hashLeaf)));

  retained.set(assignment.chunk_id, leaves);
  if (retained.size > RETAIN_MAX) {
    const oldest = retained.keys().next().value as string;
    retained.delete(oldest);
  }

  const seedsEvaluated = BigInt(assignment.range_end) - BigInt(assignment.range_start);
  const unsigned: UnsignedResult = {
    chunk_id: assignment.chunk_id,
    worker_spec_hash: assignment.worker_spec_hash,
    extremum_score: best.maxScore.toString(),
    witness_seed: best.maxSeed.toString(),
    merkle_root: root,
    buckets_count: leaves.length,
    seeds_evaluated: seedsEvaluated.toString(),
    duration_ms: durationMs,
    nonce: assignment.nonce,
  };
  const submission = { ...unsigned, signature: signResult(unsigned, secretKey) };

  const res = await api<{ accepted?: boolean; error?: unknown }>("/v1/results", submission);
  if (res.status !== 200) {
    console.error(`submit failed (${res.status}):`, res.data);
    process.exit(1);
  }
  completed++;
  const rate = Math.round(Number(seedsEvaluated) / (durationMs / 1000));
  console.log(
    `chunk ${assignment.chunk_id.slice(0, 8)} [${assignment.range_start},${assignment.range_end}) ` +
      `score=${best.maxScore} seed=${best.maxSeed} ${rate} seeds/s accepted=${res.data.accepted}`
  );
}
