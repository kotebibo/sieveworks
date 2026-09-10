# Spec 03 — Effort mode: paid-per-generation evolutionary training

**Week 2 (owner-protected).** The third verification mode: workers are paid
per verified chunk of TRAINING WORK (G generations of a seeded lineage), not
per enumeration range. The pitch-video centerpiece: an agent visibly learns
while strangers' machines earn per generation.

## 1. The core protocol design (what the exploration proved must change)

The exploration identified exactly what breaks: buckets must be
independently recomputable, `evaluate_seed` must be O(1) stateless, and
honeypots need membership-testable ranges. The design below repairs each
while INHERITING the existing chunk lifecycle, Merkle code, and audit
economics.

### The chain-of-checkpoints scheme

- A chunk = ONE lineage segment: `G` generations (e.g. G = 8192) of a
  deterministic evolutionary process from a defined start state.
- **Origin determinism**: generation-0 state for a fresh lineage is derived
  entirely from the chunk spec — `origin = expand(sha256(job_id ‖
  lineage_id ‖ 0))` via a counter-based integer PRNG INSIDE the module. No
  external randomness, ever.
- **Bucket k** = generations `[k·B, (k+1)·B)`, B = e.g. 256 (so
  n_buckets = G/B = 32 per chunk). Leaf payload = 16-byte digest of the
  END-OF-BUCKET population state: `sha256(state_bytes)[0..16]` — the SAME
  opaque-digest leaf trick as Spec 01, so `@sieveworks/merkle` is reused
  with zero changes.
- The worker retains all 32 checkpoint STATES (not just digests) until the
  challenge window passes — the existing bucket-retention rule, with blobs.

### Why the honest chain is UNIQUE (the security argument, for the audit doc)

The transition function T (one bucket of B generations) is deterministic and
the origin is forced by the chunk spec. Challenges verify (a) leaf 0's
transition FROM the derivable origin and (b) any leaf k's transition from
the state committed at leaf k−1. A self-consistent fake chain must satisfy
origin + every audited transition — by induction that IS the honest chain.
Fabricating digests without computing states fails any challenge at/after
the break with P = 1 (digests are unguessable). Skipping the second half of
the work survives an 8-bucket random audit with probability ≈ 0.5⁸ = 1/256
— **the deck's audit math carries over exactly**.

### Challenge protocol (mode 3)

Challenge k asks the worker for `state_{k-1}` (the full start-state blob;
for k = 0 nothing — the coordinator derives the origin itself):
1. Coordinator checks `sha256(state_{k-1})[0..16] == leaf_{k-1} payload`
   (and inclusion proof of BOTH leaves k−1 and k against the root).
2. Runs `advance_bucket(state, B)` in the module (bucketPool thread,
   longer timeout — see §5) → hashes end state → must equal leaf k payload.
3. Always include bucket 0 in the sampled set (origin anchor) + 7 random.
State blob size: population 64 × genome 104 B ≈ 7 KB → 8 challenged
buckets ≈ 56 KB response. Fine.

### Witness (the extremum survives)

The submission also carries `best_genome` (bytes) + `best_score` (i64) —
the best individual seen across the whole chunk. Witness check =
`evaluate_candidate(best_genome) == best_score` (O(1), reuses Spec 02's
export). This connects effort mode to the extremum story on stage AND feeds
the prize/leaderboard surface for free.

### Honeypots: none in mode 3

Replaced by: origin anchoring (bucket 0 always audited), digest
unforgeability, and audit rate 10% (like Spec 01's rationale — fewer layers,
higher sampling). Documented in the audit endpoint text.

## 2. Module ABI (mode 3)

```
init_state(lineage_seed_ptr(32), params, out_state_ptr, cap) -> i32      // origin from hash
advance_bucket(state_ptr, state_len, params, out_state_ptr, cap) -> i32  // B generations; B in params
best_of_state(state_ptr, state_len, params, out_ptr(112), ...) -> i32    // best genome + i64 score
evaluate_candidate(...)   // from Spec 02 — witness re-check
trace_candidate(...)      // from Spec 02 — replay rendering
spec_version() -> ptr
verification_mode() -> i32   // returns 2
```
The GA itself (selection/mutation/crossover, integer-only, counter-PRNG
keyed off state hash) lives INSIDE the module — unlike Spec 02's /train
page where the host evolves. Fixed-point only; conformance enforces
determinism by double-run.

## 3. Lineage continuation across chunks (the training actually progresses)

- New table `lineages (id, job_id, index, latest_state bytea, latest_state_digest,
  generations_done bigint, best_score bigint, best_genome bytea, updated_at)`.
- Job creation (bounty_kind `training`): creates M lineages (island model,
  M = parallelism knob, e.g. 32) and M initial chunks (`generation_offset
  = 0`, lineage_id set). Chunks table gains nullable `lineage_id uuid`,
  `generation_offset bigint`, **and `params jsonb` (review fix: the
  RESOLVED per-chunk params — immigrant genome included — are frozen at
  chunk creation; challenge judging reads `chunks.params`, NEVER the live
  global best, or honest workers get falsely failed whenever the global
  best moves between assignment and judging; this column is as load-bearing
  as range_start immutability)**.
- **Delivery-before-payment (inherits Spec 01 §5.4's review-fixed order):**
  challenge pass → `awaiting_outputs`; the worker delivers the final state
  (`PUT /v1/results/:id/outputs`, digest-checked against the last leaf);
  ONLY then does the crediting/accepting path run, the coordinator stores
  the state on the lineage, and inserts the NEXT chunk for that lineage
  (origin = delivered state, `generation_offset += G`) — **in the same
  transaction as the accept, BEFORE the completion check runs** (review
  fix: `verification.ts:358-373`'s "all chunks accepted → close job" count
  is unconditional today; a between-chunks lineage would transiently read
  0-remaining and close the job. Gate that check on
  `bounty_kind <> 'training'` AND insert-next-before-count). Delivery
  timeout → chunk to `pending`, no credit ever — so a redo by a second
  worker can never double-pay (no clawback path exists; credit must never
  precede delivery). Chunks are created rolling, not up front.
- Non-origin chunks' challenges use the STORED predecessor state for
  bucket-0 anchoring (coordinator has it — no re-derivation needed).
- **Migration/mixing (island model)**: every R chunks per lineage the
  coordinator injects the global best genome into the next chunk's params
  (`params.immigrant = best_genome_b64`) — the module seeds it into the
  population in `init_state`/first bucket. Cheap cross-pollination, visible
  fitness jumps for the chart. R default 4.
- Budget: `price_per_chunk` × total chunk budget as usual; job completes
  when budget is exhausted (`generations_total` param) or funder closes.
  Coverage-completion logic ("all chunks accepted → closed") must EXCLUDE
  training jobs (rolling chunks) — gate on bounty_kind.

## 4. Wire protocol

`ResultSubmission` mode value `"training"` (extends Spec 01's enum):
`extremum_score` = best_score (REQUIRED for this mode), `witness_seed`
OPTIONAL/omitted, plus new optional `best_candidate_b64`. **Schema
alignment (review fix):** Spec 01's refine is the single source of truth —
extremum fields required only for `witness_extremum`; `training` requires
`extremum_score` + `best_candidate_b64` and exempts `witness_seed`. One
shared refine, tested per mode; do NOT write a second rule here that can
drift. Signing bytes: Spec 01's optional-no-default rule.
`ChunkAssignment.params` carries `{ lineage_id, generation_offset, G, B,
population, immigrant? ... }` — no schema change (params is opaque), but
add `origin_state_digest` so workers verify they start from the right blob
(fetched via `GET /v1/lineages/:id/state` when generation_offset > 0;
served only to the current leaseholder).

## 5. Coordinator changes

- `verifyTraining` branch in the Spec 01 dispatch. Challenge judging: state
  digest check → `advance_bucket` recompute in bucketPool with a
  **mode-specific timeout** (B generations ≈ 256 × pop 64 × 1000-step sim…
  CAREFUL: that is 16M sim steps ≈ too slow for 8 s).
  **Sizing rule (load-bearing)**: pick B and sim length so ONE bucket
  recompute ≤ 2 s in WASM-under-Node.
  **MEASURED 2026-09-11 (flappy sim, worst case = full 3000-tick
  survivors): 8,710 evals/s = 26.1M ticks/s under Node.** Therefore the
  shipped defaults are: pop = 64, max_ticks = 3000, **B = 256**
  generations/bucket (≈1.9 s recompute, safety margin under the 2 s
  budget), **G = 8192** (32 buckets/chunk ≈ 60 s of worker compute per
  chunk). Audit k = max(8, ceil(32/4)) = 8; half-skip catch ≈ 1/256 as
  advertised. All four land in job params, not code.
- Audit rate env `TRAINING_AUDIT_RATE_PCT` default 10; first-3 rule
  (PASSED-only counting per Spec 01 §9b) and record-claim 100% rule reused.
- **Audit sample size scales with bucket count (review fix):** sample
  `k = max(8, ceil(n_buckets/4))` buckets (bucket 0 always included), not
  the extremum mode's fixed 8 — if the day-1 benchmark shrinks B and
  n_buckets grows, a fixed 8 silently degrades small-fraction-skip
  detection. Document the actual catch-probability table for the SHIPPED
  G/B once benchmarked (the deck's 1/256 half-skip number must be
  re-derived, not assumed).
- **Lineage re-audit (review fix for compounding poisoning):** training
  chunks are sequential state — one unaudited fabricated chunk corrupts
  everything after it, forever, and nothing re-checks accepted history.
  Two cheap repairs ship with the mode: (a) a sweeper "slow lane" that
  re-verifies a random ACCEPTED training chunk end-to-end (full G-generation
  replay from its stored origin to its stored final state — coordinator has
  both blobs; ~60 s of background WASM per pick, rate ~1 per few minutes)
  and voids/flags the lineage on mismatch; (b) a per-chunk plausibility
  record (fitness delta + a population-diversity stat emitted by
  `best_of_state`) charted per lineage — a flatlined/collapsed lineage is
  VISIBLE on the training page rather than silently burning budget
  (SPEC.md §2.1's distribution-tracking idea, applied).
- SSE: `lineage_advanced { job_id, lineage, generations_done, best_score }`.
- Sweeper: challenge/delivery windows as in Spec 01 + the slow-lane
  re-audit above.

## 6. Web — the training page (`/train/[jobId]` evolves into this)

- Fitness-over-generations chart per lineage + global best line (SSE-fed,
  `job_generations`-style query off lineages table).
- Live replay canvas of the current global best genome (trace_candidate).
- **Shared bounty page fix (review):** `/bounties/[id]`'s progress bar and
  swarm grid compute done/total from the LIVE chunks table — under rolling
  creation a training job would show ~100% then regress, mid-demo. For
  `bounty_kind='training'` the page must show generations_done /
  generations_total (from lineages) and a lineage-grid instead of the
  chunk-range swarm; also null-guard its `BigInt(extremum_score)` reduce
  (crashes on non-extremum results — same fix family as Spec 01 §10).
- Contribute integration: mode-3 jobs APPEAR on /contribute like any job —
  the engine branch runs init/advance buckets instead of evaluate_range,
  retains state blobs, delivers final state. Thread model: ONE lineage
  chunk per worker thread (chunks are sequential internally — a chunk
  cannot be split across threads; parallelism comes from M lineages).
  This is a real engine.ts change; plan a day for it.

## 7. Sequencing (Week 2, 6 working days)

| Day | Deliverable |
|---|---|
| 1 | Bench harness: sim-steps/s in WASM-under-Node + browser → fix G/B/pop/steps defaults; migration (lineages, chunks.lineage_id, bounty_kind 'training'); evo module gains init_state/advance_bucket/best_of_state (GA inside, integer PRNG). |
| 2 | Determinism harness extended to state-chain (two full-chunk runs → identical checkpoint digests, native ≡ WASM); conformance suite mode 3. |
| 3 | Coordinator: verifyTraining (witness + chain challenges + always-bucket-0), state delivery + rolling next-chunk creation + immigrant mixing. |
| 4 | Browser engine mode-3 branch (state retention/delivery, sequential buckets); cheat-client mode-3 variants (fabricated tail digests → caught; wrong origin → caught; skipped-half → caught at 1/256 doc rate). |
| 5 | Training page (chart + replay); fund the flagship training bounty on prod; clips. |
| 6 | Buffer + hardening + docs (audit endpoint text for mode 3, honesty notes). |

## 8. Risks

- **Bucket recompute cost** is THE technical risk → day-1 benchmark gates
  all parameter choices; if 2 s/bucket is unreachable, shrink B (more
  leaves, same tree code) — the knob exists by construction.
- State blob growth (lineages.latest_state ~7 KB × M×jobs — trivial).
- Engine sequentiality reduces per-worker parallelism on training jobs
  (one chunk per thread × M lineages must exceed typical swarm size —
  M default 32 covers a demo swarm; make M a job param).
- Sniping/leeching a delivered state: origin states served only to the
  active leaseholder; acceptable for the month, note in audit text.
- This spec depends on Spec 01 (dispatch, delivery machinery, digest leaf)
  and Spec 02 (evaluate_candidate, evo module base, /train page) — do not
  reorder.
- Stake honesty (Spec 01 §9b) applies with extra force here: training pays
  repeatedly per chunk, so until stake enforcement lands, training bounties
  are own-funded demo budgets and the docs say so.

## 9. Decisions taken by default

- GA lives inside the module for mode 3 (determinism demands it); host-side
  GA remains only on Spec 02's /train page for the open prize.
- Island model with coordinator-mediated immigrant mixing (R=4).
- Bucket 0 always audited (origin anchor); audit rate 10%.
- Payment per accepted chunk at job price — no new payout mechanics; escrow
  budget bounds total generations (honest "budget buys training time").
