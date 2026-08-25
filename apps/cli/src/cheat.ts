import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { type BucketLeaf, hashLeaf, merkleRoot, toHex } from "@sieveworks/merkle";
import {
  ChunkAssignment,
  signResult,
  SubmissionResponse,
  walletFromSecretKey,
  type UnsignedResult,
} from "@sieveworks/protocol";

/**
 * Adversarial client — proves each verification layer catches its attack.
 * A rejection here is SUCCESS. Each mode submits a well-formed, correctly
 * SIGNED result (so it clears the §8.1 gate) that lies in one specific way:
 *
 *   over-report  → claim a higher score than the witness produces  (witness catches)
 *   under-report → return a minimum, skipping the range            (honeypot catches)
 *   fake-root    → real extremum, but a fabricated merkle root      (challenge catches)
 */

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORE = join(
  here, "..", "..", "..", "packages", "worker-core", "out", "native",
  process.platform === "win32" ? "sieve_core.exe" : "sieve_core"
);

const { values: args } = parseArgs({
  options: {
    job: { type: "string" },
    mode: { type: "string" }, // over-report | under-report | fake-root
    wallet: { type: "string", default: "cheater-wallet.json" },
    coordinator: { type: "string", default: "http://localhost:8080" },
    core: { type: "string", default: DEFAULT_CORE },
  },
});

if (!args.job || !args.mode) {
  console.error("usage: cheat --job <id> --mode over-report|under-report|fake-root [--wallet f] [--coordinator url]");
  process.exit(2);
}
if (!existsSync(args.wallet!)) {
  writeFileSync(args.wallet!, JSON.stringify(Array.from(randomBytes(32))));
}
const secretKey = Uint8Array.from(JSON.parse(readFileSync(args.wallet!, "utf8")));
const wallet = walletFromSecretKey(secretKey);

async function api<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${args.coordinator}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

console.log(`cheater ${wallet} · mode=${args.mode} · job ${args.job}`);
const lease = await api<unknown>("/v1/lease", { job_id: args.job, wallet_address: wallet });
if (lease.status !== 200) {
  console.error(`lease failed (${lease.status})`, lease.data);
  process.exit(1);
}
const a = ChunkAssignment.parse(lease.data);
const paramsJson = JSON.stringify(a.params);

// Honestly evaluate first so we know the truth we're lying about.
const out = execFileSync(args.core!, ["eval-range", a.range_start, a.range_end, String(a.bucket_size), paramsJson], {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
const leaves: BucketLeaf[] = out.trim().split(/\r?\n/).map((line) => {
  const [i, s, sd] = line.split(" ");
  return { index: Number(i), maxScore: BigInt(s!), maxSeed: BigInt(sd!) };
});
let best = leaves[0]!;
for (const l of leaves) if (l.maxScore > best.maxScore) best = l;

let extremum = best.maxScore;
let witness = best.maxSeed;
let root = toHex(merkleRoot(leaves.map(hashLeaf)));

if (args.mode === "over-report") {
  // Claim 1000 more than the witness actually produces.
  extremum = best.maxScore + 1000n;
} else if (args.mode === "under-report") {
  // Pretend the whole range is barren: report the minimum bucket as the max.
  let worst = leaves[0]!;
  for (const l of leaves) if (l.maxScore < worst.maxScore) worst = l;
  extremum = worst.maxScore;
  witness = worst.maxSeed;
  // Rebuild a consistent tree for the lie so only the honeypot layer trips.
  const faked = leaves.map((l) => ({ ...l, maxScore: l.maxScore > worst.maxScore ? worst.maxScore : l.maxScore }));
  root = toHex(merkleRoot(faked.map(hashLeaf)));
} else if (args.mode === "fake-root") {
  // Correct extremum + witness, but a garbage commitment we can't open.
  root = toHex(randomBytes(32));
}

const unsigned: UnsignedResult = {
  chunk_id: a.chunk_id,
  worker_spec_hash: a.worker_spec_hash,
  extremum_score: extremum.toString(),
  witness_seed: witness.toString(),
  merkle_root: root,
  buckets_count: leaves.length,
  seeds_evaluated: (BigInt(a.range_end) - BigInt(a.range_start)).toString(),
  duration_ms: 1,
  nonce: a.nonce,
};
const submission = { ...unsigned, signature: signResult(unsigned, secretKey) };
const res = await api<unknown>("/v1/results", submission);

if (res.status !== 200) {
  console.log(`REJECTED at gate (${res.status}) — caught. ✅`);
  process.exitCode = 0;
}
let verdict = SubmissionResponse.parse(res.data);
console.log(`  submission status: ${verdict.status}`);

if (verdict.status === "challenged" && verdict.challenge) {
  // fake-root path: we cannot produce valid proofs for a root we invented.
  // Send our real leaves; inclusion proof against the fake root will fail.
  const hashes = leaves.map(hashLeaf);
  const { merkleProof } = await import("@sieveworks/merkle");
  const answer = {
    result_id: verdict.result_id,
    leaves: verdict.challenge.bucket_indices.map((i) => ({
      index: i, max_score: leaves[i]!.maxScore.toString(), max_seed: leaves[i]!.maxSeed.toString(),
    })),
    proofs: verdict.challenge.bucket_indices.map((i) => merkleProof(hashes, i).map(toHex)),
  };
  const judged = await api<{ status: string }>("/v1/challenge-response", answer);
  verdict = { result_id: verdict.result_id, status: (judged.data.status ?? "rejected") as "accepted" | "rejected" };
  console.log(`  challenge verdict: ${verdict.status}`);
}

if (verdict.status === "rejected") {
  console.log("REJECTED — the cheat was caught. ✅");
  process.exitCode = 0;
} else {
  console.error("ACCEPTED — the cheat slipped through. ❌ THIS IS A BUG.");
  process.exitCode = 1;
}
