import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SieveWorkerModule } from "@sieveworks/wasm-runtime";
import { sql } from "./db.js";

/**
 * The multi-module verifier. A job pins a worker_spec_hash; the coordinator
 * loads THAT module (by hash, from the registry) to verify its results. This
 * is what makes Sieveworks a platform: every community's module runs on the
 * same rails, and the coordinator can verify any of them because it holds the
 * exact artifact each job pinned.
 *
 * Modules are content-addressed and cached in memory. Untrusted uploaded
 * modules are still just WASM instantiated with no I/O imports (see
 * wasm-runtime) — they can compute, not touch the machine.
 */

const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

// Built-in modules seeded into the registry on boot (the reference workers).
const BUILTINS = [
  {
    file: "sieve_core.wasm",
    name: "Minecraft seedfinding",
    description: "Score seeds by biome diversity or mushroom terrain near spawn (cubiomes). The launch vertical.",
    example_params: { scorer: "biome_diversity", version_pin: "1.21.1", radius: 256 },
    default_range_start: "0",
    default_range_end: "2000000",
  },
  {
    file: "hashgrind.wasm",
    name: "Hash-grind (proof-of-work)",
    description: "Score a seed by the leading zero bits of sha256(seed ‖ salt). Hard to find, one hash to check — the thesis in its purest form. Not Minecraft.",
    example_params: { salt: "sieveworks" },
    default_range_start: "0",
    default_range_end: "5000000",
  },
  {
    file: "spawn_quality.wasm",
    name: "Minecraft spawn quality",
    description: "Find a cool seed: graded score weighting overworld structures near spawn (villages, temples, monuments, mansions, ancient cities) plus biome variety. What a community actually wants to run.",
    example_params: { version_pin: "1.21.1", radius: 1000 },
    default_range_start: "0",
    default_range_end: "5000000",
  },
];

class ModuleRegistry {
  private readonly cache = new Map<string, SieveWorkerModule>();
  private readonly bytesCache = new Map<string, Uint8Array>();

  /** Seed built-in modules from the committed artifacts if absent. */
  async seedBuiltins(): Promise<string[]> {
    const hashes: string[] = [];
    for (const b of BUILTINS) {
      const bytes = new Uint8Array(await readFile(join(artifactsDir, b.file)));
      const hash = createHash("sha256").update(bytes).digest("hex");
      hashes.push(hash);
      const [existing] = await sql`select hash from worker_specs where hash = ${hash}`;
      if (existing) continue;
      const mod = await SieveWorkerModule.load(bytes, hash);
      await sql`
        insert into worker_specs (hash, name, description, spec_version, wasm, conformance,
                                  example_params, default_range_start, default_range_end, is_builtin)
        values (${hash}, ${b.name}, ${b.description}, ${mod.specVersion()},
                ${Buffer.from(bytes)}, ${sql.json({ builtin: true, passed: true } as never)},
                ${sql.json(b.example_params as never)}, ${b.default_range_start},
                ${b.default_range_end}, true)
        on conflict (hash) do nothing`;
      this.cache.set(hash, mod);
      this.bytesCache.set(hash, bytes);
    }
    return hashes;
  }

  /** Load a module by hash — from cache, else from the registry, verifying the
   * artifact's hash before instantiation (drift is impossible). */
  async get(hash: string): Promise<SieveWorkerModule> {
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const bytes = await this.getBytes(hash);
    const mod = await SieveWorkerModule.load(bytes, hash);
    this.cache.set(hash, mod);
    return mod;
  }

  async getBytes(hash: string): Promise<Uint8Array> {
    const cached = this.bytesCache.get(hash);
    if (cached) return cached;
    const [row] = await sql<{ wasm: Buffer }[]>`select wasm from worker_specs where hash = ${hash}`;
    if (!row) throw new Error(`unknown worker_spec_hash: ${hash}`);
    const bytes = new Uint8Array(row.wasm);
    this.bytesCache.set(hash, bytes);
    return bytes;
  }

  has(hash: string): boolean {
    return this.cache.has(hash);
  }
}

export const registry = new ModuleRegistry();
