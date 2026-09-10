# Spec 01 — `output_hash` verification mode + Mandelbrot render module

**Week 1, days 1–3.** Generalizes verification from "extremum search" to
"deterministic output production," proven by a render module whose output
visibly assembles on screen from swarm compute.

## 1. Design summary

Today every layer assumes extremum semantics (audited exploration confirmed:
no `verification_mode` exists anywhere; the pipeline is one linear function).
The generalization introduces a **mode discriminator** carried by the module
artifact itself, a **mode-keyed dispatch** in the pipeline, and **reuses the
Merkle commit-and-challenge machinery unchanged** via one observation:

> The Merkle leaf payload is 21 bytes: `u32 index + i64 + u64`
> (`packages/merkle/src/index.ts:25-36`). In extremum mode the 16 payload
> bytes mean `(max_score, max_seed)`. In `output_hash` mode they are an
> **opaque 128-bit digest** = first 16 bytes of sha256 of the bucket's output
> bytes. `encodeLeaf`, `merkleRoot`, `merkleProof`, `verifyProof` need ZERO
> changes — only the semantic doc comment.

### Mode roster (this spec ships the second; spec 03 adds the third)
| mode | work unit | commitment | spot check | record path |
|---|---|---|---|---|
| `witness_extremum` (existing) | fold range → best (score, seed) | Merkle over bucket extrema | witness re-eval + honeypots + bucket recompute | scalar record comparison |
| `output_hash` (this spec) | produce bucket output bytes | Merkle over bucket digests | bucket recompute → digest compare | none (outputs are the product) |

## 2. Module ABI (mode 2)

A mode-2 module exports:
```
render_bucket(range_start: u64, range_end: u64, params_ptr, params_len,
              out_ptr, out_cap: i32) -> i32   // bytes written, negative = error
spec_version() -> ptr
verification_mode() -> i32                    // returns 1
```
- `verification_mode` is a NEW OPTIONAL export across all modules: absent or
  returning 0 = `witness_extremum` (all existing artifacts stay valid with
  unchanged hashes); 1 = `output_hash`. The mode travels WITH the artifact —
  no registry metadata to drift.
- Modules never hash. The HOST (shared `wasm-runtime`) hashes returned bytes:
  `digest16 = sha256(bucket_bytes)[0..16]`. One hashing implementation for
  browser + coordinator, same "zero drift" property as today.
- `evaluate_seed`/`evaluate_range` are NOT required for mode 2;
  `WORKER_ABI` check in `wasm-runtime` becomes mode-aware at load.
- Determinism contract unchanged: same inputs → identical bytes, enforced by
  the conformance gate (§6) and the same `-ffp-contract=off` discipline.
- Output size cap per bucket: `OUT_CAP = 64 KiB` (enforced host-side); a
  module writing more fails the bucket. Mandelbrot tile fits easily (§8).

## 3. Wire protocol (packages/protocol)

`ResultSubmission` gains a discriminator, keeping the existing shape as the
default so current workers/CLI need no change:

```ts
// REVIEW-FIXED: optional WITHOUT .default() — canonicalJson already drops
// undefined keys (canonical.ts:25), so legacy signatures verify with zero
// extra plumbing and explicit-mode submissions include the key naturally.
// Normalize `mode ?? "witness_extremum"` in business logic only, NEVER in
// the schema or the signing path.
mode: z.enum(["witness_extremum", "output_hash", "training"]).optional(),
// extremum fields optional; refine: REQUIRED when effective mode is
// 'witness_extremum'. For 'training' (Spec 03): extremum_score REQUIRED
// (= best_score), witness_seed OPTIONAL (witness is best_candidate_b64).
// One refine covers all three modes — Specs 01/03 share this schema.
extremum_score: i64String.optional(),
witness_seed: u64String.optional(),
```
- `merkle_root`, `buckets_count`, `seeds_evaluated` (renamed in docs to
  "units_evaluated", column unchanged), `duration_ms`, `nonce`, `signature`
  keep working identically for both modes.
- `ChallengeLeaf`: mode-2 leaves carry the 16 digest bytes in the existing
  `max_score`/`max_seed` fields. **REVIEW-FIXED encoding rule**: both wire
  values are produced by reading the digest bytes as SIGNED two's-complement
  (`DataView.getBigInt64(..., true)` for BOTH halves is wrong for the u64
  field — precisely: `max_score` = `getBigInt64(0, true)` (signed, always
  within i64String's refine), `max_seed` = `getBigUint64(8, true)` (u64String
  accepts full unsigned range). A random digest read UNSIGNED into the score
  field would fail `i64String`'s I64_MAX refine ~50% of the time
  (numeric.ts:22-28) — the signed read makes every digest representable.
  `encodeLeaf`'s setBigInt64/setBigUint64 round-trip these exactly.

### Output delivery (new, mode 2 only)
Digests prove work; funders need the bytes. After a submission is accepted
(or concurrently), the worker POSTs `PUT /v1/results/:id/outputs` —
`{ bucket_index, bytes (base64) }[]` batched — and the coordinator verifies
`sha256(bytes)[0..16] == committed leaf digest` for EVERY bucket (cheap hash
check, not work verification) before storing. Undelivered outputs after the
delivery window (default 10 min) return the chunk to `pending` (no slash —
delivery failure is not proven fraud; the digest may be honest).

## 4. Data model (migration `2026091?000001_verification_modes.sql`)

```sql
alter table jobs         add column verification_mode text not null default 'witness_extremum'
  check (verification_mode in ('witness_extremum','output_hash'));
alter table worker_specs add column verification_mode text not null default 'witness_extremum';
alter table results      alter column extremum_score drop not null;
alter table results      alter column witness_seed  drop not null;
create table chunk_outputs (
  result_id uuid not null references results(id),
  bucket_index int not null,
  bytes bytea not null,          -- ≤ 64 KiB enforced in code
  primary key (result_id, bucket_index)
);
-- rejection reasons: add 'output_digest_mismatch', 'output_delivery_timeout'
```
`worker_specs.verification_mode` is derived at upload (from the artifact's
export) and stored for query convenience; the artifact remains the truth.
Job creation copies the spec's mode onto the job (`jobs.ts`); a job's mode is
immutable.

## 5. Coordinator pipeline changes (`verification.ts`)

Refactor `verifySubmission` into a small dispatch:

```
verifySubmission(...) {
  ctx.mode = row.verification_mode
  if (ctx.mode === 'witness_extremum') return verifyExtremum(...)   // exact current code
  return verifyOutputHash(...)
}
```

`verifyOutputHash` steps:
1. **No witness, no honeypots** (structurally meaningless for digests — the
   exploration confirmed honeypots rely on score ordering).
2. **Challenge decision**: forced 100% for a worker's first 3 judged results
   (same rule); otherwise `OUTPUT_AUDIT_RATE_PCT` (default **10%**, separate
   env var) — higher than extremum's 5% because this mode has ONE detection
   layer instead of three. Economics note for docs: fabricating a digest
   fails an audited bucket with P=1 (digest space is unguessable), so
   per-chunk catch probability = audit rate, and stake sizing follows the
   same negative-EV arithmetic.
3. **Challenge judging** (`judgeChallengeResponse` dispatch): inclusion
   proofs identical; truth recompute calls `bucketPool.renderBucket(...)` →
   host hashes → compare 16-byte digest to leaf payload. Mismatch →
   `challenge_failed`, slash — same as today.
4. **REVIEW-FIXED — delivery gates payment, not the reverse.** Challenge
   pass/skip transitions the chunk to `awaiting_outputs` with **NO earnings
   credit and no `accepted` state yet**. Only successful digest-checked
   delivery of ALL buckets calls the accepting/crediting path (earnings +
   SSE + state `accepted`). Delivery timeout → chunk returns to `pending`
   with **zero earnings ever granted** for that attempt (still no slash —
   not proven fraud — but never paid either). This kills the
   "get credited, never deliver" dominant strategy the adversarial review
   proved against the earlier draft, and it is the invariant Spec 03
   inherits (a re-done chunk must never coexist with a paid undelivered
   one — there is no clawback path in the system, so credit must simply
   never precede delivery).
   Record path skipped entirely (no scalar to compare; `attestFind` not
   called — attestation remains extremum-only, honest).
5. State flow: `submitted` → [`verifying`] → `awaiting_outputs` →
   `accepted`. Migration note: adding `'awaiting_outputs'` to the chunks
   state check requires `DROP CONSTRAINT` + re-`ADD` (Postgres check
   constraints are not extendable in place). Sweeper owns the delivery
   timeout.
6. **Digest salting (review)**: the leaf digest is
   `sha256(job_id_bytes ‖ bucket_bytes)[0..16]` — salted by job so
   byte-identical outputs cannot be resold across jobs sharing params.
   The conformance gate uses a fixed all-zero salt (no job exists there).

`bucketPool`/`verifyThread` gain a `renderBucket` op (same 8s timeout +
auto-restart pattern; returns bytes, host-side hash in the pool).

## 6. Conformance gate (mode-aware)

`conformanceThread.ts` dispatch on the artifact's `verification_mode` export:
- mode 1 (existing): unchanged determinism + witness invariant.
- mode 2 (REVIEW-HARDENED — the gate must exercise the REAL call patterns,
  not a truncated toy range): (a) run a full realistic chunk (chunk_size
  sequential `render_bucket` calls in worker order) TWICE in one instance →
  byte-identical; (b) recompute a random subset of those buckets as
  ISOLATED single calls in a FRESH instance → identical to the sequential
  run (proves call-order/history independence, which is exactly what
  challenge recompute assumes); (c) every bucket nonempty and ≤ OUT_CAP;
  `spec_version()` present. A module that branches on call order or hidden
  global state fails (b).

## 7. Browser worker (`apps/web/lib/worker/*`)

- `evaluator.worker.ts`: mode branch — for mode 2 call `render_bucket` per
  bucket, host-hash to leaf digest, retain BYTES (not just leaves) until
  delivery completes.
- `engine.ts`: no chunk-level extremum fold for mode 2; submit with
  `mode: 'output_hash'`, omit extremum fields; after accept/challenge, PUT
  outputs. Memory bound: 100 buckets × 64 KiB = ≤ 6.4 MiB/chunk, fine.
- Contribute UI: for mode-2 jobs, replace "best score" tile with a live
  canvas painting delivered buckets (the demo moment, nearly free since the
  worker holds the bytes anyway).

## 8. The Mandelbrot module (`packages/worker-core-mandel/` — C, emcc)

- Params: `{ center_re, center_im, span, grid: 4096, max_iter: 1000,
  palette: "sieve-brass" }` — all fixed-point integers in params
  (e.g. re/im/span as scaled i64 ×2^32) so no float parsing ambiguity.
- Unit index → pixel tile: the search space `[0, grid²/TILE²)` enumerates
  64×64-pixel tiles row-major; one bucket (1024 units is too many for
  tiles) — **bucket_size for render jobs = 1** (one tile per bucket/leaf;
  chunk = 64 tiles). `bucket_size` is already per-job in the DB and REQUIRED
  in `ChunkAssignment`, so this needs zero schema work; chunk_size 64.
- Tile output: 64×64 pixels, 1 byte/pixel (palette index 0-255) = 4096
  bytes/tile — well under cap; web canvas maps palette client-side.
- **Escape-iteration math in pure integers** (fixed-point Mandelbrot is
  standard); iteration count per pixel IS deterministic. `-O2
  -ffp-contract=off` flags as usual, but no floats at all by construction.
- Registered as a fourth builtin in `moduleRegistry.ts` BUILTINS.
- Web: `/render/[jobId]` page (or job-detail panel) assembling delivered
  tiles into the full image via SSE. This page is the W1 X-clip.

## 9. Sequencing (3 days)

| Day | Deliverable (each day ends deployed) |
|---|---|
| 1 | Migration; protocol mode field + signing-bytes rule + unit tests; wasm-runtime mode-aware load + host hashing; conformance dispatch. Deploy: everything existing still green (regression = the 25 unit tests + a posted extremum bounty E2E). |
| 2 | Coordinator dispatch (`verifyOutputHash`, renderBucket pool op, output delivery endpoint + `awaiting_outputs` state + sweeper); CLI/cheat-client mode-2 variants for adversarial tests (fabricated digest → caught; corrupted delivery → caught). |
| 3 | Mandelbrot C module + conformance pass; browser worker mode branch; render page; fund a real mode-2 bounty on prod; record the clip. |

## 9b. Cross-cutting hardening (adversarial review, applies W1 day 2)

- **First-3 gate counts only `passed` results.** Today
  `verification.ts:106-111` counts `failed` too and is global — three free
  sacrificial garbage submissions age any wallet out of the 100%-audit
  window forever. One-line fix (`verification_state = 'passed'`) + test.
  Applies to ALL modes including existing extremum.
- **Stake honesty.** `worker_stakes` is dormant, no lease gate, slash is a
  jsonb note — so "cheating is negative EV" is NOT currently true for any
  mode at 5–10% audit rates (expected gain (1−r)·price > expected loss
  r·0). Until stake enforcement is wired: (a) the audit endpoint and docs
  must describe the deterrent honestly (forfeited payment + audit exposure,
  stake on roadmap); (b) paid bounties stay own-funded demo budgets.
  Wiring minimal stake (stakeIx builder + lease gate + slash call) is a
  W2/W3 buffer item — owner decision in 90-decisions.md.

## 10. Risks / gotchas

- **Dockerfile filter list**: `worker-core-mandel` (and any new package) must
  be added to `apps/coordinator/Dockerfile` — known deploy landmine.
- **Signing-bytes back-compat**: solved structurally by `.optional()` with
  no default (§3) — canonicalJson drops absent keys; test both shapes
  anyway.
- `results.extremum_score` NOT NULL drop — null-tolerance sweep required
  in BOTH known readers (review-confirmed): the CSV route
  (`routes.ts:512-535`, gate by job mode) AND the job-detail page
  (`bounties/[id]/page.tsx:56-59` does `BigInt(r.extremum_score)` in a
  reduce over the unfiltered results feed → crashes on the first mode-2
  result; also `lib/api.ts:39` types the field non-nullable). Null-guard
  the reduce, gate the record panel on
  `job.verification_mode === 'witness_extremum'`, update the api type.
- `seeds_evaluated` naming: keep column, present as "units" in UI copy only.
- Blob growth: `chunk_outputs` for a 4096² render = 4096 tiles × 4 KiB =
  16 MiB/job — fine for Supabase; add `delete from chunk_outputs` on job
  close ONLY IF funder has downloaded (skip for demo month; note it).

## 11. Decisions taken by default (owner may override)

- Mode discriminator = WASM export (not registry metadata). Reason: travels
  with the artifact, content hash covers it.
- Mode-2 audit rate 10% (env-tunable). Reason: one detection layer.
- On-chain attestation stays extremum-only this week. Reason: no scalar
  "find" to attest; inventing one would be fake depth.
- Output delivery is post-accept with a digest check per bucket. Reason:
  keeps verification pure and the submission payload small.
