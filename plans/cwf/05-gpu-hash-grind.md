# Spec 05 — GPU hash-grind kernel (wgpu/WebGPU)

**Week 3, stretch (cut-order #2; vanity-grade secp256k1 GPU is cut-order
#1 and is NOT specced — explicitly not promised).** A GPU execution engine
behind the SAME `evaluate_range` contract, verified by the unchanged CPU
reference recompute — the "GPU worker, CPU-verified" beat.

## 1. Why hash-grind first (explorer-grounded)

`hashgrind.c` is self-contained integer SHA-256 (no floats, no cubiomes):
score = leading-zero bits of `sha256(seed_LE8 ‖ salt)`. Bit-identical GPU
output is straightforwardly achievable; the Minecraft modules (float noise)
are not credibly bit-stable on GPU and are out of scope permanently under
the determinism rules.

## 2. Design

- **WebGPU compute shader (WGSL)** running in the desktop app's webview
  (primary; day-1 WebView2 check per Spec 04 — fallback: native wgpu behind
  a Tauri command returning the same per-bucket pairs).
- Kernel: one dispatch per bucket batch; each invocation hashes one seed
  (message = fixed 40 bytes: 8-byte LE seed + 32-byte salt → single
  SHA-256 block after padding — one-block special case, hardcoded schedule,
  no generic hasher needed); workgroup reduction to per-bucket
  `(max_score, max_seed)` honoring the protocol tie-break **strictly
  greater, ties → lowest seed** (reduce with `(score > best) || (score ==
  best && seed < bestSeed)` — order within workgroup scan must be made
  deterministic: reduce over seed-ascending pairs, standard parallel
  reduction preserves the rule because the comparator is total).
- Host (engine GPU path): map results, build the SAME leaves →
  `@sieveworks/merkle` → sign → submit. The coordinator cannot tell and
  must not care (no protocol change, no coordinator change).
- Engine integration: `packages/worker-engine` gains an `Executor`
  interface { evaluateBuckets(range, params) } with `WasmExecutor`
  (existing) and `GpuHashgrindExecutor` (module-hash-gated: ONLY activates
  when the leased job's `worker_spec_hash` equals the pinned hashgrind
  builtin hash AND WebGPU is present; everything else uses WASM). This
  hash-gating is the honesty guard — the GPU path never runs a module it
  wasn't hand-verified against.

## 3. Determinism gate (the non-negotiable)

Extend `packages/worker-core/test/determinism.mjs` with a third leg:
GPU ≡ WASM over the fixed ranges (run via a headless harness in the desktop
app's dev mode, or a small `wgpu` Rust test binary — decide by what's
fastest to stand up; the Rust test doubles as the native-fallback
implementation). CI-blocking for desktop releases. If the GPU EVER
diverges, the GPU is wrong (WASM stays the reference, same rule as native).

## 4. Verification story (for docs/pitch)

Nothing changes: the worker's leaves face the same witness/honeypot/
challenge machinery; the coordinator recomputes challenged buckets with the
pinned WASM on CPU. "A thousand GPUs fail the same check one does." This is
the cleanest proof that verification is execution-engine-independent —
say exactly that in the pitch video if this ships.

## 5. Sequencing (2 days inside W3, only if W3 day 2 ends on schedule)

| Day | Deliverable |
|---|---|
| 1 | WGSL kernel + reduction; harness leg proving GPU ≡ WASM on fixed ranges; perf number captured (seeds/sec vs CPU — the X-clip stat). |
| 2 | Engine `GpuHashgrindExecutor` + hash-gating + desktop toggle ("GPU: on"); E2E accepted chunks on prod; clip. |

## 6. Risks

- Tie-break subtlety in parallel reduction is the one real correctness
  trap — the harness leg exists precisely for it; test ranges must include
  crafted tie cases (two seeds with equal scores in one bucket).
- WebGPU absence on the demo machine → native wgpu fallback costs an extra
  half-day; the day-1 check in Spec 04 de-risks early.
- Perf expectations: browser-CPU hashgrind ≈ 3.4 M seeds/s claim; GPU
  should land 50–500 M/s. If the measured multiple is unimpressive on the
  dev machine's GPU, the feature still ships as capability, but drop the
  perf stat from the pitch rather than fudge it (honesty rails).

## 7. Decisions taken by default

- Hash-gated to the hashgrind builtin only; no generic GPU module system
  (that would be a plugin system — SPEC.md §13 forbids it).
- WASM remains the reference implementation for all time; GPU is an
  optimization of the worker side only.
