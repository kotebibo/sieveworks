# @sieveworks/desktop — native worker

The desktop client. Same protocol as the browser worker, but the heavy compute
runs on your machine's CPU (and, next, its GPU) instead of inside a browser tab.

> **Status: scaffold (v0.1).** The shell compiles, the frontend builds, the
> worker loop is wired end-to-end against the live coordinator, and the compute
> executor has unit tests. What is *not* done yet: the wgpu GPU kernel, bundling
> the native core as a sidecar, packaging/signing an installer. See
> [What needs your machine](#what-needs-your-machine).

---

## Why this exists (and two design questions answered)

### Why a desktop app at all
The website is onboarding: "click contribute, watch your browser find things."
That's the on-ramp. But a browser tab is a bad place to do *serious* compute —
it's sandboxed away from the GPU's full power and it pauses when backgrounded.
Real contributors want to point a whole machine (or a rig) at a bounty and walk
away. That's the desktop app: the same verifiable-work protocol, running native.

### Why one repo, one folder (not a separate repo)
This app lives at `apps/desktop` inside the Sieveworks monorepo **on purpose**.
Our core security claim is *zero-drift*: the coordinator verifies a result with
the byte-identical artifact the worker ran. The moment the desktop worker lives
in a separate repo, it depends on *published* versions of
`@sieveworks/protocol`, `@sieveworks/merkle`, `@sieveworks/chain` — and the day
the web worker signs with schema vN while the desktop still ships vN-1, a
legitimate result gets rejected and "identical artifact" becomes a lie. In one
repo, all three clients consume `workspace:*` — literally the same source,
bumped together in one commit. (Bonus: for a solo project judged partly on
coherent scope, one repo where web/desktop/CLI/coordinator/on-chain interlock
is a far stronger artifact than four repos stitched together.)

### Why WebGPU/wgpu, not Vulkan directly
The compute path targets **WebGPU via [`wgpu`](https://wgpu.rs)** (the Rust impl
of the WebGPU standard), not raw Vulkan. Three reasons, most-important first:

1. **One kernel, every GPU.** Vulkan is a single backend — writing to it alone
   abandons every Mac (Metal) and the DX12 fallback. `wgpu` abstracts over
   Vulkan **and** Metal **and** DX12 **and** GL: we write the compute shader once
   in WGSL and it runs the right backend per machine. For a network whose entire
   value is "anyone's hardware can join," portability *is* the product.
2. **Same shape as the browser.** The browser's GPU API *is* WebGPU. Targeting
   it here means the mental model — and eventually much of the shader code — is
   shared between "try it in your browser" and "run it seriously on desktop,"
   instead of forked in two.
3. **Safety + sanity.** Raw Vulkan is thousands of lines of boilerplate and
   manual synchronization before you compute a single number, each an
   opportunity for UB. `wgpu` gives validated, memory-safe access to the same
   hardware in a fraction of the code.

The honest tradeoff: a hand-tuned Vulkan kernel can beat `wgpu` by ~10%. For
embarrassingly-parallel range grinding that gap is negligible, and the
portability + browser-parity win is decisive.

---

## Architecture

```
┌─ webview (src/) ─────────────────────────────┐   ┌─ Rust host (src-tauri/) ─┐
│ worker loop, reuses @sieveworks/{protocol,    │   │  eval_range command      │
│ merkle}: lease → merkle → SIGN (local key)    │──▶│  → native core today     │
│ → submit → answer challenge. Key never leaves │◀──│  → wgpu WGSL kernel next  │
└───────────────────────────────────────────────┘   └──────────────────────────┘
```

The trust split is the whole point: **the frontend owns the key and does all
signing/Merkle**, exactly like the browser worker. The Rust layer only ever
receives a seed range and returns per-bucket extrema — it never sees the key.
That's what keeps the desktop client byte-identical to the web and CLI clients
(`apps/cli/src/index.ts` is the same loop shape) and preserves zero-drift.

- `src/main.ts` — the worker loop (TypeScript, reuses the shared packages).
- `src-tauri/src/executor.rs` — resolves + drives the native core; pure parsing
  is unit-tested (`cargo test --lib`).
- `src-tauri/src/lib.rs` — the two Tauri commands: `eval_range`, `core_status`.

---

## Develop

```bash
pnpm install                      # from repo root
pnpm --filter @sieveworks/desktop build       # builds the frontend (verified)
cd apps/desktop/src-tauri && cargo test --lib # runs executor tests (verified)
```

The worker loop needs the native core binary. In the monorepo it's auto-resolved
at `packages/worker-core/out/native/sieve_core(.exe)`; override with
`SIEVE_CORE=/path/to/binary`. Build it with the worker-core toolchain if absent.

## What needs your machine

These steps launch a GUI or produce a signed installer, so they can't be
verified headless — run them yourself:

1. **Install the Tauri CLI** (once): `pnpm add -D @tauri-apps/cli` is already in
   `package.json`; the Rust side also wants the WebView2 runtime (preinstalled
   on Win 11) and, on Linux, `libwebkit2gtk`.
2. **Run it**: `pnpm --filter @sieveworks/desktop tauri dev` — opens the window,
   hot-reloads the frontend. Paste a job id, hit *Start working*.
3. **Package**: `pnpm --filter @sieveworks/desktop tauri build` — produces an
   installer under `src-tauri/target/release/bundle/`. Code signing (Apple
   notarization / Windows Authenticode) is a separate, credential-gated step.

## Next (tracked, not done)

- wgpu/WGSL compute kernel behind the same `eval_range` command (CPU core stays
  as fallback for GPU-less machines).
- Bundle the native core as a Tauri sidecar so installs are self-contained.
- Persist the worker key to the OS keychain instead of webview storage.
- Real icons (current ones are brand-blue placeholders).
