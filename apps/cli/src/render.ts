import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  type BucketLeaf,
  hashLeaf,
  merkleProof,
  merkleRoot,
  toHex,
} from "@sieveworks/merkle";
import {
  ChunkAssignment,
  digest16ToWire,
  signResult,
  SubmissionResponse,
  walletFromSecretKey,
  type UnsignedResult,
} from "@sieveworks/protocol";
import { bucketDigest16, SieveWorkerModule } from "@sieveworks/wasm-runtime";

/**
 * Mode-2 (output_hash) CLI worker: lease → render tiles via the job's own
 * WASM artifact (fetched from the coordinator, hash-verified) → job-salted
 * digest leaves → merkle commit → sign → submit → answer challenges →
 * DELIVER the bytes (delivery is what gets paid).
 *
 * --cheat fabricate        commit garbage digests (must be caught by challenge)
 * --cheat corrupt-delivery render honestly, deliver wrong bytes (delivery 422)
 */

const { values: args } = parseArgs({
  options: {
    job: { type: "string" },
    wallet: { type: "string", default: "worker-wallet.json" },
    coordinator: { type: "string", default: "http://localhost:8080" },
    "max-chunks": { type: "string" },
    cheat: { type: "string" },
  },
});

if (!args.job) {
  console.error("usage: render-worker --job <id> [--wallet keypair.json] [--coordinator url] [--cheat fabricate|corrupt-delivery]");
  process.exit(2);
}
if (!existsSync(args.wallet!)) {
  console.error(`wallet file ${args.wallet} not found — run index.ts --keygen first`);
  process.exit(2);
}

const secretKey = Uint8Array.from(JSON.parse(readFileSync(args.wallet!, "utf8")));
const wallet = walletFromSecretKey(secretKey);
const maxChunks = args["max-chunks"] ? Number(args["max-chunks"]) : Infinity;
const cheat = args.cheat ?? null;
console.log(`render worker ${wallet} → ${args.coordinator} job ${args.job}${cheat ? ` CHEAT=${cheat}` : ""}`);

async function api<T>(path: string, body?: unknown, method?: string): Promise<{ status: number; data: T }> {
  const res = await fetch(`${args.coordinator}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

function jobSalt16(jobId: string): Uint8Array {
  const hex = jobId.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let mod: SieveWorkerModule | null = null;
async function moduleFor(specHash: string): Promise<SieveWorkerModule> {
  if (mod && mod.specHash === specHash) return mod;
  const res = await fetch(`${args.coordinator}/v1/specs/${specHash}/artifact`);
  if (!res.ok) throw new Error(`artifact fetch failed: ${res.status}`);
  mod = await SieveWorkerModule.load(new Uint8Array(await res.arrayBuffer()), specHash);
  if (mod.verificationMode !== "output_hash") throw new Error(`module is ${mod.verificationMode}, not output_hash`);
  return mod;
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
  const a = ChunkAssignment.parse(lease.data);
  const m = await moduleFor(a.worker_spec_hash);
  const salt = jobSalt16(a.job_id);
  const paramsJson = JSON.stringify(a.params);

  const start = BigInt(a.range_start);
  const end = BigInt(a.range_end);
  const bucket = BigInt(a.bucket_size);

  const t0 = Date.now();
  const outputs: Uint8Array[] = [];
  const leaves: BucketLeaf[] = [];
  let index = 0;
  for (let s = start; s < end; s += bucket, index++) {
    const e = s + bucket < end ? s + bucket : end;
    let bytes = m.renderBucket(s, e, paramsJson);
    outputs.push(bytes);
    let digest = bucketDigest16(salt, bytes);
    if (cheat === "fabricate") {
      digest = crypto.getRandomValues(new Uint8Array(16)); // committed lie
    }
    const wire = digest16ToWire(digest);
    leaves.push({ index, maxScore: BigInt(wire.score), maxSeed: BigInt(wire.seed) });
  }
  const durationMs = Date.now() - t0;
  const root = toHex(merkleRoot(leaves.map(hashLeaf)));

  const unsigned: UnsignedResult = {
    chunk_id: a.chunk_id,
    worker_spec_hash: a.worker_spec_hash,
    mode: "output_hash",
    merkle_root: root,
    buckets_count: leaves.length,
    seeds_evaluated: (end - start).toString(),
    duration_ms: durationMs,
    nonce: a.nonce,
  };
  const submission = { ...unsigned, signature: signResult(unsigned, secretKey) };
  const res = await api<unknown>("/v1/results", submission);
  if (res.status !== 200) {
    console.error(`submit failed (${res.status}):`, res.data);
    process.exit(1);
  }
  let verdict = SubmissionResponse.parse(res.data);

  if (verdict.status === "challenged" && verdict.challenge) {
    const hashes = leaves.map(hashLeaf);
    const challengeResponse = {
      result_id: verdict.result_id,
      leaves: verdict.challenge.bucket_indices.map((i) => ({
        index: i,
        max_score: leaves[i]!.maxScore.toString(),
        max_seed: leaves[i]!.maxSeed.toString(),
      })),
      proofs: verdict.challenge.bucket_indices.map((i) => merkleProof(hashes, i).map(toHex)),
    };
    const judged = await api<{ status: string }>("/v1/challenge-response", challengeResponse);
    verdict = { result_id: verdict.result_id, status: (judged.data.status ?? "rejected") as "accepted" | "rejected" };
    console.log(`  challenged on [${challengeResponse.leaves.map((l) => l.index).join(",")}] → ${verdict.status}`);
  }

  if (verdict.status === "rejected") {
    if (cheat) {
      console.log(`cheat '${cheat}' was CAUGHT at verification — the system works. exiting.`);
      process.exit(0);
    }
    console.error("submission rejected — halting (honest workers should never see this)");
    process.exit(1);
  }

  // Verification passed → deliver the bytes (this is what gets paid).
  let delivery = outputs;
  if (cheat === "corrupt-delivery") {
    delivery = outputs.map((b) => { const c = new Uint8Array(b); c[0] = c[0]! ^ 0xff; return c; });
  }
  const put = await api<{ ok?: boolean; error?: string }>(
    `/v1/results/${verdict.result_id}/outputs`,
    { outputs: delivery.map((b) => Buffer.from(b).toString("base64")) },
    "PUT"
  );
  if (put.status !== 200) {
    if (cheat === "corrupt-delivery") {
      console.log(`corrupt delivery REJECTED (${put.status}: ${put.data.error}) — digest gate works. exiting.`);
      process.exit(0);
    }
    if (cheat === "fabricate") {
      // Dodged the audit, but no bytes can ever match a garbage root — the
      // fabricator is never paid. Defense holds on the second gate.
      console.log(`fabricated commitment dodged the audit but delivery was rejected (${put.status}) — unpaid. defense holds. exiting.`);
      process.exit(0);
    }
    console.error(`delivery failed (${put.status}):`, put.data);
    process.exit(1);
  }
  if (cheat === "fabricate") {
    console.error("BUG: fabricated commitment was accepted AND delivered");
    process.exit(1);
  }

  completed++;
  const tiles = Number(end - start);
  console.log(
    `chunk ${a.chunk_id.slice(0, 8)} [${a.range_start},${a.range_end}) ${tiles} tile(s) ` +
      `${Math.round(tiles / (durationMs / 1000))} tiles/s delivered+accepted`
  );
}
