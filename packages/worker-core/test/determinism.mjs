// Day 1 deliverable (spec §3): the native CLI build and the WASM build must
// produce identical output over fixed seed ranges and fixed params. The WASM
// build is the reference — if they diverge, the native build is wrong.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SieveWorkerModule } from "@sieveworks/wasm-runtime";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const exe = join(root, "out", "native", platform() === "win32" ? "sieve_core.exe" : "sieve_core");
const wasmPath = join(root, "out", "wasm", "sieve_core.wasm");
const expectedHash = readFileSync(join(root, "out", "wasm", "sieve_core.wasm.sha256"), "utf8").trim();

const CASES = [
  {
    name: "biome_diversity r256 v1.21.1",
    params: '{"radius":256,"scorer":"biome_diversity","version_pin":"1.21.1"}',
    start: 1_000_000n,
    end: 1_004_096n,
    bucket: 1024n,
  },
  {
    name: "mushroom_fields r512 v1.21",
    params: '{"radius":512,"scorer":"mushroom_fields","version_pin":"1.21"}',
    start: 77_000_000_000n,
    end: 77_000_002_048n,
    bucket: 1024n,
  },
];

const wasm = await SieveWorkerModule.load(readFileSync(wasmPath), expectedHash);
console.log(`wasm loaded, worker_spec_hash=${wasm.specHash}`);

let failures = 0;

const nativeVersion = execFileSync(exe, ["spec-version"], { encoding: "utf8" }).trim();
const wasmVersion = wasm.specVersion();
if (nativeVersion !== wasmVersion) {
  console.error(`FAIL spec_version: native="${nativeVersion}" wasm="${wasmVersion}"`);
  failures++;
} else {
  console.log(`ok  spec_version: ${nativeVersion}`);
}

for (const c of CASES) {
  const nativeOut = execFileSync(
    exe,
    ["eval-range", String(c.start), String(c.end), String(c.bucket), c.params],
    { encoding: "utf8" }
  )
    .trim()
    .split(/\r?\n/);

  const wasmOut = [];
  let index = 0;
  for (let s = c.start; s < c.end; s += c.bucket, index++) {
    const e = s + c.bucket < c.end ? s + c.bucket : c.end;
    const { maxScore, maxSeed } = wasm.evaluateRange(s, e, c.params);
    wasmOut.push(`${index} ${maxScore} ${maxSeed}`);

    // Witness cross-check: single-seed evaluation must reproduce the bucket max.
    const witnessScore = wasm.evaluateSeed(maxSeed, c.params);
    if (witnessScore !== maxScore) {
      console.error(`FAIL ${c.name}: witness ${maxSeed} scores ${witnessScore} != ${maxScore}`);
      failures++;
    }
  }

  if (nativeOut.join("\n") === wasmOut.join("\n")) {
    console.log(`ok  ${c.name}: ${wasmOut.length} buckets identical`);
    for (const line of wasmOut) console.log(`      ${line}`);
  } else {
    console.error(`FAIL ${c.name}: native and wasm diverge`);
    console.error(`  native: ${JSON.stringify(nativeOut)}`);
    console.error(`  wasm:   ${JSON.stringify(wasmOut)}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`DETERMINISM TEST FAILED: ${failures} failure(s)`);
  process.exit(1);
}
console.log("DETERMINISM TEST PASSED");
