import { invoke } from "@tauri-apps/api/core";
import {
  type BucketLeaf,
  hashLeaf,
  merkleProof,
  merkleRoot,
  toHex,
} from "@sieveworks/merkle";
import {
  ChunkAssignment,
  signResult,
  SubmissionResponse,
  walletFromSecretKey,
  type UnsignedResult,
} from "@sieveworks/protocol";

/**
 * Desktop worker loop. Structurally identical to apps/cli — lease → evaluate →
 * merkle → sign → submit → answer challenge — but the evaluate step calls the
 * Rust `eval_range` command (native core today, wgpu GPU kernel later) instead
 * of shelling out. Signing and the local key never leave this frontend; the
 * Rust layer only ever sees a seed range. That is the same trust split as the
 * browser worker, which is what keeps all three clients byte-identical.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>("log");
const statsEl = $<HTMLDivElement>("stats");
const startBtn = $<HTMLButtonElement>("start");
const stopBtn = $<HTMLButtonElement>("stop");

function log(line: string) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

// --- local worker key -----------------------------------------------------
// Persisted in the webview's storage. Same ed25519 seed shape as the CLI's
// keygen (32 raw bytes). A real build would let the user point at a wallet
// file / hardware key; scaffold keeps it simple and local.
function loadOrCreateSecret(): Uint8Array {
  const stored = localStorage.getItem("sieve.worker.secret");
  if (stored) return Uint8Array.from(JSON.parse(stored));
  const secret = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem("sieve.worker.secret", JSON.stringify(Array.from(secret)));
  return secret;
}

const secretKey = loadOrCreateSecret();
const wallet = walletFromSecretKey(secretKey);
$("wallet").textContent = wallet;

// Which builtin native cores this machine can run + whether the GPU path is
// active (hashgrind, self-conformed to the native core). Shown up front.
Promise.all([
  invoke<string[]>("core_status").catch(() => []),
  invoke<string | null>("gpu_status").catch(() => null),
]).then(([cores, gpuBackend]) => {
  const coreText = cores.length ? cores.join(", ") : "no native cores found";
  const gpuText = gpuBackend ? ` · GPU: ${gpuBackend} (hash-grind)` : " · GPU: CPU-only";
  $("core").textContent = coreText + gpuText;
  if (cores.length) $("core").classList.remove("dim");
});

// Rust returns snake_case strings; convert to the BucketLeaf bigint shape the
// merkle package hashes.
type RawLeaf = { index: number; max_score: string; max_seed: string };
function toLeaves(raw: RawLeaf[]): BucketLeaf[] {
  return raw.map((r) => ({ index: r.index, maxScore: BigInt(r.max_score), maxSeed: BigInt(r.max_seed) }));
}

let running = false;
const retained = new Map<string, BucketLeaf[]>();
const RETAIN_MAX = 8;

async function api<T>(base: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

async function workLoop() {
  const base = ($<HTMLInputElement>("coordinator").value || "").replace(/\/$/, "");
  const job = $<HTMLInputElement>("job").value.trim();
  if (!job) { log("enter a job id first"); stop(); return; }

  let completed = 0;
  let seedsTotal = 0n;
  const t0 = performance.now();

  while (running) {
    const lease = await api<unknown>(base, "/v1/lease", { job_id: job, wallet_address: wallet });
    if (lease.status === 404) { log(`job drained — completed ${completed} chunk(s)`); break; }
    if (lease.status === 402) { log("stake required — bond this wallet on the web app first"); break; }
    if (lease.status !== 200) { log(`lease failed (${lease.status})`); break; }

    const a = ChunkAssignment.parse(lease.data);
    const cStart = performance.now();
    let raw: { core_path: string; leaves: RawLeaf[] };
    try {
      raw = await invoke<{ core_path: string; leaves: RawLeaf[] }>("eval_range", {
        specHash: a.worker_spec_hash,
        rangeStart: a.range_start,
        rangeEnd: a.range_end,
        bucketSize: Number(a.bucket_size),
        paramsJson: JSON.stringify(a.params),
      });
    } catch (e) {
      // e.g. a community/WASM-only module: the native worker can't run it.
      log(`cannot evaluate this job natively: ${e}`);
      break;
    }
    const leaves = toLeaves(raw.leaves);
    const durationMs = Math.round(performance.now() - cStart);

    // Extremum fold: strictly-greater, lowest-seed tie-break. Protocol rule —
    // identical to the C core and the CLI.
    let best = leaves[0]!;
    for (const leaf of leaves) if (leaf.maxScore > best.maxScore) best = leaf;
    const root = toHex(merkleRoot(leaves.map(hashLeaf)));

    retained.set(a.chunk_id, leaves);
    if (retained.size > RETAIN_MAX) retained.delete(retained.keys().next().value as string);

    const seeds = BigInt(a.range_end) - BigInt(a.range_start);
    const unsigned: UnsignedResult = {
      chunk_id: a.chunk_id,
      worker_spec_hash: a.worker_spec_hash,
      extremum_score: best.maxScore.toString(),
      witness_seed: best.maxSeed.toString(),
      merkle_root: root,
      buckets_count: leaves.length,
      seeds_evaluated: seeds.toString(),
      duration_ms: durationMs,
      nonce: a.nonce,
    };
    const submission = { ...unsigned, signature: signResult(unsigned, secretKey) };

    const res = await api<unknown>(base, "/v1/results", submission);
    if (res.status !== 200) { log(`submit failed (${res.status})`); break; }
    let verdict = SubmissionResponse.parse(res.data);

    if (verdict.status === "challenged" && verdict.challenge) {
      const hashes = leaves.map(hashLeaf);
      const cr = {
        result_id: verdict.result_id,
        leaves: verdict.challenge.bucket_indices.map((i) => ({
          index: i,
          max_score: leaves[i]!.maxScore.toString(),
          max_seed: leaves[i]!.maxSeed.toString(),
        })),
        proofs: verdict.challenge.bucket_indices.map((i) => merkleProof(hashes, i).map(toHex)),
      };
      const judged = await api<{ status: string }>(base, "/v1/challenge-response", cr);
      verdict = { result_id: verdict.result_id, status: (judged.data.status as "accepted" | "rejected") };
      log(`  challenged [${cr.leaves.map((l) => l.index).join(",")}] → ${verdict.status}`);
    }

    if (verdict.status === "accepted") { completed++; seedsTotal += seeds; }
    if (verdict.status === "rejected") { log("submission rejected — halting"); break; }

    const rate = Math.round(Number(seeds) / (durationMs / 1000));
    log(`chunk ${a.chunk_id.slice(0, 8)} score=${best.maxScore} ${rate.toLocaleString()} seeds/s ${verdict.status}`);
    const elapsed = (performance.now() - t0) / 1000;
    statsEl.textContent = `${completed} chunks · ${(Number(seedsTotal) / 1e6).toFixed(1)}M seeds · ${Math.round(Number(seedsTotal) / elapsed).toLocaleString()} seeds/s avg`;
  }
  stop();
}

function start() {
  if (running) return;
  running = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  void workLoop();
}
function stop() {
  running = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
