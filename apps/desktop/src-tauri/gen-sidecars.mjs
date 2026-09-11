// Copies the native worker-core binaries into src-tauri/binaries/ with Tauri's
// required `<name>-<target-triple>[.exe]` naming, so `tauri build` bundles them
// as sidecars and the installed app is self-contained (no dev tree needed).
// Run automatically by beforeBuildCommand; a no-op-safe best effort otherwise.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // src-tauri/
const nativeDir = join(here, "..", "..", "..", "packages", "worker-core", "out", "native");
const outDir = join(here, "binaries");
const BINARIES = ["sieve_core", "hashgrind", "spawn_quality"];

// Target triple (e.g. x86_64-pc-windows-msvc) — Tauri names sidecars by it.
let triple;
try {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  triple = out.match(/host:\s*(\S+)/)?.[1];
} catch {
  /* rustc missing */
}
if (!triple) {
  console.error("gen-sidecars: could not determine target triple (is rustc on PATH?) — skipping");
  process.exit(0);
}
const ext = triple.includes("windows") ? ".exe" : "";

mkdirSync(outDir, { recursive: true });
let copied = 0;
for (const b of BINARIES) {
  const src = join(nativeDir, `${b}${ext}`);
  if (!existsSync(src)) {
    console.warn(`gen-sidecars: ${src} not found — build worker-core to bundle ${b}`);
    continue;
  }
  copyFileSync(src, join(outDir, `${b}-${triple}${ext}`));
  copied++;
}
console.log(`gen-sidecars: copied ${copied}/${BINARIES.length} sidecar(s) for ${triple}`);
