import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SieveWorkerModule } from "@sieveworks/wasm-runtime";

/**
 * The coordinator's verifier IS the worker artifact (spec §3): the identical
 * .wasm browser workers run, loaded by content hash. It only ever evaluates
 * single seeds or single buckets, so throughput is irrelevant.
 */

const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

export async function loadVerifier(): Promise<SieveWorkerModule> {
  const wasmPath = process.env.WORKER_WASM_PATH ?? join(artifactsDir, "sieve_core.wasm");
  const hashPath = wasmPath + ".sha256";
  const [bytes, hash] = await Promise.all([
    readFile(wasmPath),
    readFile(hashPath, "utf8").then((s) => s.trim()),
  ]);
  return SieveWorkerModule.load(new Uint8Array(bytes), hash);
}
