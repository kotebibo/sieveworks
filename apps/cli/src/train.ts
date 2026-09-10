import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
 * Training (mode 3) CLI worker: lease a lineage segment → derive/fetch the
 * start state → advance bucket-by-bucket (RETAINING every checkpoint state
 * for transition challenges) → commit digests → submit with the best-genome
 * witness → answer challenges (start states + prev-leaf proofs) → deliver
 * the final state (which is what gets paid AND what rolls the lineage).
 *
 * --cheat fabricate-tail  do the first half honestly, fabricate the rest
 *                         (must be caught by a challenge landing in the tail,
 *                         or die unpaid at delivery)
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

if (!args.job || !existsSync(args.wallet!)) {
  console.error("usage: train-worker --job <id> --wallet keypair.json [--coordinator url] [--cheat fabricate-tail]");
  process.exit(2);
}
const secretKey = Uint8Array.from(JSON.parse(readFileSync(args.wallet!, "utf8")));
const wallet = walletFromSecretKey(secretKey);
const maxChunks = args["max-chunks"] ? Number(args["max-chunks"]) : Infinity;
const cheat = args.cheat ?? null;
console.log(`train worker ${wallet} → ${args.coordinator} job ${args.job}${cheat ? ` CHEAT=${cheat}` : ""}`);

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
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

let mod: SieveWorkerModule | null = null;
async function moduleFor(specHash: string): Promise<SieveWorkerModule> {
  if (mod && mod.specHash === specHash) return mod;
  const res = await fetch(`${args.coordinator}/v1/specs/${specHash}/artifact`);
  if (!res.ok) throw new Error(`artifact fetch failed: ${res.status}`);
  mod = await SieveWorkerModule.load(new Uint8Array(await res.arrayBuffer()), specHash);
  if (mod.verificationMode !== "training") throw new Error(`module is ${mod.verificationMode}, not training`);
  return mod;
}

let completed = 0;
while (completed < maxChunks) {
  const lease = await api<unknown>("/v1/lease", { job_id: args.job, wallet_address: wallet });
  if (lease.status === 404) {
    console.log(`no pending chunks — done for now. completed ${completed} chunk(s).`);
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
  const p = a.params as { lineage_id?: string; generation_offset?: string };
  const nBuckets = Number((BigInt(a.range_end) - BigInt(a.range_start)) / BigInt(a.bucket_size));

  // Start state: origin chunks derive it from the lineage seed (pure
  // function — the coordinator derives the same one); continuations fetch
  // the predecessor's delivered state.
  let state: Uint8Array;
  if (!p.generation_offset || p.generation_offset === "0") {
    const seed = new Uint8Array(createHash("sha256").update(`sieveworks-lineage:${a.job_id}:${p.lineage_id}`).digest());
    state = m.initState(seed, paramsJson);
  } else {
    const org = await api<{ state_b64?: string; error?: string }>(`/v1/chunks/${a.chunk_id}/origin-state?wallet=${wallet}`);
    if (org.status !== 200 || !org.data.state_b64) throw new Error(`origin fetch failed: ${org.status} ${org.data.error}`);
    state = new Uint8Array(Buffer.from(org.data.state_b64, "base64"));
  }

  const t0 = Date.now();
  const startStates: Uint8Array[] = []; // start state of each bucket, retained for challenges
  const leaves: BucketLeaf[] = [];
  const fabricateFrom = cheat === "fabricate-tail" ? Math.floor(nBuckets / 2) : Infinity;
  for (let k = 0; k < nBuckets; k++) {
    startStates.push(state);
    if (k >= fabricateFrom) {
      const junk = crypto.getRandomValues(new Uint8Array(16));
      const wire = digest16ToWire(junk);
      leaves.push({ index: k, maxScore: BigInt(wire.score), maxSeed: BigInt(wire.seed) });
      continue; // no work done — that's the point
    }
    state = m.advanceBucket(state, paramsJson);
    const wire = digest16ToWire(bucketDigest16(salt, state));
    leaves.push({ index: k, maxScore: BigInt(wire.score), maxSeed: BigInt(wire.seed) });
  }
  const durationMs = Date.now() - t0;
  const root = toHex(merkleRoot(leaves.map(hashLeaf)));

  const witness = m.bestOfState(state, paramsJson);
  const bestScore = new DataView(witness.buffer, witness.byteOffset).getBigInt64(0, true);
  const bestGenome = witness.slice(8);

  const unsigned: UnsignedResult = {
    chunk_id: a.chunk_id,
    worker_spec_hash: a.worker_spec_hash,
    mode: "training",
    extremum_score: bestScore.toString(),
    best_candidate_b64: Buffer.from(bestGenome).toString("base64"),
    merkle_root: root,
    buckets_count: leaves.length,
    seeds_evaluated: (BigInt(a.range_end) - BigInt(a.range_start)).toString(),
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
    const idxs = verdict.challenge.bucket_indices;
    const challengeResponse = {
      result_id: verdict.result_id,
      leaves: idxs.map((i) => ({
        index: i,
        max_score: leaves[i]!.maxScore.toString(),
        max_seed: leaves[i]!.maxSeed.toString(),
      })),
      proofs: idxs.map((i) => merkleProof(hashes, i).map(toHex)),
      states_b64: idxs.map((i) => (i === 0 ? "" : Buffer.from(startStates[i]!).toString("base64"))),
      prev_leaves: idxs.map((i) =>
        i === 0 ? null : { index: i - 1, max_score: leaves[i - 1]!.maxScore.toString(), max_seed: leaves[i - 1]!.maxSeed.toString() }
      ),
      prev_proofs: idxs.map((i) => (i === 0 ? null : merkleProof(hashes, i - 1).map(toHex))),
    };
    const judged = await api<{ status: string }>("/v1/challenge-response", challengeResponse);
    verdict = { result_id: verdict.result_id, status: (judged.data.status ?? "rejected") as "accepted" | "rejected" };
    console.log(`  challenged on [${idxs.join(",")}] → ${verdict.status}`);
  }

  if (verdict.status === "rejected") {
    if (cheat) {
      console.log(`cheat '${cheat}' was CAUGHT at verification — the chain audit works. exiting.`);
      process.exit(0);
    }
    console.error("submission rejected — halting (honest workers should never see this)");
    process.exit(1);
  }

  // Deliver the final state — payment and lineage continuation.
  const lastIdx = leaves.length - 1;
  const put = await api<{ ok?: boolean; error?: string }>(
    `/v1/results/${verdict.result_id}/outputs`,
    {
      state_b64: Buffer.from(state).toString("base64"),
      last_leaf: { index: lastIdx, max_score: leaves[lastIdx]!.maxScore.toString(), max_seed: leaves[lastIdx]!.maxSeed.toString() },
      proof: merkleProof(leaves.map(hashLeaf), lastIdx).map(toHex),
    },
    "PUT"
  );
  if (put.status !== 200) {
    if (cheat === "fabricate-tail") {
      console.log(`fabricated tail dodged the audit but delivery was rejected (${put.status}: ${put.data.error}) — unpaid. defense holds.`);
      process.exit(0);
    }
    console.error(`delivery failed (${put.status}):`, put.data);
    process.exit(1);
  }
  if (cheat === "fabricate-tail") {
    console.error("BUG: fabricated-tail chunk was accepted AND delivered");
    process.exit(1);
  }

  completed++;
  const gens = nBuckets * Number((a.params as { gens_per_bucket?: number }).gens_per_bucket ?? 256);
  console.log(
    `chunk ${a.chunk_id.slice(0, 8)} lineage ${(p.lineage_id ?? "").slice(0, 8)} +${gens} gens ` +
      `best=${bestScore} (${Math.floor(Number(bestScore) / 10000)} pipes) ${(durationMs / 1000).toFixed(1)}s delivered+accepted`
  );
}
