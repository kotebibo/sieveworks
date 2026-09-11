# Sieveworks — architecture

A map of the system for a reviewer. The thesis in one line: **hard to find,
easy to check** — for problems with compact inputs, deterministic evaluation,
and a witness anyone can re-verify in microseconds, you can distribute the
search to untrusted machines and pay per *verified* result on-chain, without
re-running the work redundantly.

The single invariant everything hangs on: **the coordinator verifies with the
byte-identical artifact the worker ran**, pinned by content hash
(`worker_spec_hash`). Worker/verifier drift is impossible by construction — and
that is why the same monorepo holds every client (see [README](README.md) for
the repo-vs-folder rationale in `apps/desktop`).

---

## The pieces

| Component | Path | Role |
|---|---|---|
| Web app | `apps/web` | Next.js 15 on Vercel (sievework.com). Onboarding + the browser worker (WASM), bounty creation, wallet, live viz. |
| Coordinator | `apps/coordinator` | Fastify on Fly. Leases chunks, runs the verification pipeline, gates payment, signs the on-chain rails. The one trusted-but-publicly-auditable party. |
| CLI worker | `apps/cli` | Native worker + the adversarial cheat client used in E2E tests. |
| Desktop worker | `apps/desktop` | Tauri (Rust + webview). Native CPU worker + a **wgpu GPU hash-grind kernel**. Reuses the same protocol/merkle packages as web/CLI. |
| Anchor program | `programs/sieveworks` | Solana (devnet). Escrow, find attestation, stake/unstake/slash, co-signed claims, and the training fraud-proof scaffold. |
| Shared packages | `packages/*` | `protocol` (wire schemas + canonical signing), `merkle` (commit/challenge), `wasm-runtime` (sandboxed module host), `chain` (hand-encoded Anchor instructions), `worker-core` (the C modules → WASM + native). |
| DB | `supabase` | Postgres + RLS. Honeypots and rejection reasons are deliberately policy-dark. |

Data plane: **web/CLI/desktop → coordinator (HTTP) → Postgres**, with Solana
devnet as the settlement + attribution layer. The heavy compute never touches
the coordinator; it only re-verifies a sampled fraction.

---

## Verification — one pipeline, four surfaces

A job pins a module whose WASM declares a `verification_mode`. The coordinator
dispatches on it (`apps/coordinator/src/verification.ts`):

1. **`witness_extremum`** (search) — every chunk answers "the highest-scoring
   seed in this range, with a witness." No fakeable "found nothing." Defenses:
   the witness re-check, **honeypot** seeds (secret known-answers that catch
   under-reporting), and a **Merkle commit-and-challenge** (workers commit a
   root; the coordinator opens and recomputes random buckets).
2. **`output_hash`** (render/delivery) — the range indexes tiles of a
   deterministic output (e.g. a Mandelbrot render); delivery gates payment; the
   same digest-challenge, no witness/honeypot.
3. **`training`** (paid-per-generation evolution) — a chunk is a lineage segment
   of a genetic algorithm; the worker commits a checkpoint chain and delivers
   the final state, which becomes the next chunk's origin. Verified today by a
   probabilistic challenge + a slow-lane replay; **upgrading to interactive
   fraud proofs** (see below).
4. **prize** (orthogonal, no lease) — open candidate submission verified in a
   dedicated eval pool; `apps/coordinator/src/candidates.ts`.

Measured overhead ≈ **0.9% at a 10% audit rate** for search, versus ~200% for
run-it-twice replication. Every claimed record is fully recomputed before
on-chain attribution.

---

## Money + trust on-chain (`programs/sieveworks`)

All instructions are hand-encoded in `packages/chain` (no IDL) and mirrored in
`apps/coordinator/src/chain.ts`.

- **Escrow** — a funder locks a budget in a `JobEscrow` PDA at
  `initialize_job`; only the funder can reclaim (`close_job`, which now requires
  the coordinator to co-sign so a prize funder can't sweep the pot mid-race).
- **Attestation** — the coordinator signs `record_find` for each verified
  record; the finds page renders the explorer link.
- **Stake / unstake-lock / slash** — paid work requires a one-time global
  `WorkerStake` bond. The coordinator re-checks it at submit. Withdrawal
  (`unstake`) requires the coordinator to co-sign (bound to a fixed authority
  key, since the bond is global with no escrow to carry the pubkey); it refuses
  while any lease/challenge is outstanding. A caught cheat's bond is **burned**
  to the incinerator — never to the coordinator or funder, so neither profits
  from slashing and a Sybil can't self-refund. At a 10% audit rate the burn
  puts fabrication below zero expected value.
- **Claims** — payouts are pull-based, co-signed vouchers with monotonic
  cumulative arithmetic (replay-safe).

Honest trust boundary, stated plainly: the coordinator is a **trusted (not yet
decentralized) verifier**. Its decisions are all independently re-verifiable
off-chain via the audit endpoint, but availability and honesty currently rest
on it. Removing that is the fraud-proof work.

---

## Fraud proofs for training (Spec 03b, in progress)

Training is sequential, so verifying it cheaply is the hard part. The chosen
direction (owner-ratified) is **interactive fraud proofs (bisection)** — the
TrueBit/Arbitrum approach — because for a compute *marketplace* the prover cost
must stay near zero (a zkVM would tax every worker 10³–10⁶×). The on-chain
scaffold is live on devnet: a `TrainingLineage` PDA anchors each lineage as a
hash chain rooted at `init_state`; `assert_chunk` enforces that a chunk
continues the real confirmed chain; `confirm_chunk` advances the anchor only
after a challenge window (window-gated finality = prevention, not just
detection); `reject_chunk` records a public, re-computable fraud transcript.
Full design + status: `plans/cwf/03b-fraud-proof-training-verification.md`.

---

## Desktop worker + GPU (`apps/desktop`)

A Tauri shell whose webview frontend runs the same lease → evaluate → Merkle →
**sign** → submit loop as the CLI, reusing `@sieveworks/{protocol,merkle}`
byte-identically. The signing key lives only in the frontend; the Rust layer
sees only a seed range — the same host-owns-the-key split as the browser
worker. The Rust `eval_range` command selects the native core by the job's
module (`sieve_core`/`hashgrind`/`spawn_quality`), and for hash-grind can run a
**wgpu/WGSL sha256 GPU kernel** — gated by a self-conformance check that only
activates the GPU if its output matches the native core bit-for-bit, else falls
back to CPU. `apps/desktop/README.md` covers why WebGPU/wgpu over raw Vulkan.

---

## Determinism discipline (why any of this is safe)

- Modules are content-addressed; a job pins one hash and the coordinator
  verifies with exactly those bytes.
- Native and WASM builds of a module must agree; the desktop/CLI native path is
  the same C source compiled two ways.
- The GPU kernel must be bit-exact with the reference or it self-disables.
- Fixed-point / integer math only in the compute modules — no floats, no
  wall-clock, no unsandboxed I/O (WASM is instantiated with no host imports).
