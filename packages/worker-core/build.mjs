// Builds the worker core twice from identical sources:
//   node build.mjs native  -> out/native/sieve_core[.exe]
//   node build.mjs wasm    -> out/wasm/sieve_core.wasm (+ .sha256 = worker_spec_hash)
//   node build.mjs         -> both
//
// Float determinism: -ffp-contract=off on BOTH targets so the native build
// cannot fuse multiply-adds the WASM build doesn't have. If they ever
// diverge, the native build is wrong (spec §3).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const vendor = join(root, "vendor", "cubiomes");

const CUBIOMES_SRCS = ["noise.c", "biomes.c", "layers.c", "biomenoise.c", "generator.c", "util.c"].map(
  (f) => join(vendor, f)
);
const CORE_SRC = join(root, "src", "sieve_core.c");
const CLI_SRC = join(root, "src", "cli_main.c");

const COMMON_FLAGS = ["-O2", "-ffp-contract=off", `-I${vendor}`, `-I${join(root, "src")}`];

function run(cmd, args, useShell = false) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", shell: useShell });
}

function buildNative() {
  const outDir = join(root, "out", "native");
  mkdirSync(outDir, { recursive: true });
  const exe = join(outDir, platform() === "win32" ? "sieve_core.exe" : "sieve_core");
  run("gcc", [...COMMON_FLAGS, "-o", exe, CORE_SRC, CLI_SRC, ...CUBIOMES_SRCS, "-lm"]);
  console.log(`native: ${exe}`);
}

function findEmcc() {
  if (process.env.EMCC) return process.env.EMCC;
  if (platform() === "win32") {
    const home = process.env.USERPROFILE ?? "C:\\Users\\pc";
    return join(home, "emsdk", "upstream", "emscripten", "emcc.exe");
  }
  return "emcc";
}

function buildWasm() {
  const outDir = join(root, "out", "wasm");
  mkdirSync(outDir, { recursive: true });
  const wasm = join(outDir, "sieve_core.wasm");
  const emcc = findEmcc();
  run(
    emcc,
    [
      ...COMMON_FLAGS,
      "-sSTANDALONE_WASM",
      "--no-entry",
      "-sALLOW_MEMORY_GROWTH",
      "-sEXPORTED_FUNCTIONS=_evaluate_seed,_evaluate_range,_spec_version,_malloc,_free",
      "-o",
      wasm,
      CORE_SRC,
      ...CUBIOMES_SRCS,
      "-lm",
    ]
  );
  const bytes = readFileSync(wasm);
  const hash = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(outDir, "sieve_core.wasm.sha256"), hash + "\n");
  console.log(`wasm: ${wasm}`);
  console.log(`worker_spec_hash: ${hash}`);
}

const target = process.argv[2] ?? "all";
if (target === "native" || target === "all") buildNative();
if (target === "wasm" || target === "all") buildWasm();
