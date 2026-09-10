# Spec 02 — Prize (result-bounty) mode + evolutionary "AI learns" module

**Week 1, days 4–7.** Adds a second BOUNTY pricing model (orthogonal to
Spec 01's verification modes): winner-takes-prize for the best verified
candidate above a threshold by a deadline. Proven by an evolutionary module
where workers train agents locally and submit genomes.

## 1. Design summary

Coverage bounties pay per verified chunk of enumeration. Prize bounties pay
for OUTCOMES: submissions are candidate artifacts (genome bytes), verification
is one deterministic re-evaluation of the claimed fitness (the witness
re-check generalized from a u64 seed to a byte blob), and settlement reuses
the existing escrow + voucher machinery with **zero new Anchor instructions**
(explorer-confirmed):

- Award = upsert the winner's `earnings.cumulative_lamports = prize_lamports`
  in one shot; the worker claims through the EXISTING
  `GET /v1/claims/:jobId/voucher` → co-sign → `claim()` flow unchanged.
- No winner by deadline = funder reclaims via `close_job` — the instruction
  is deployed but **unwired** (no builder in packages/chain, no route, no UI).
  Wiring it is part of this spec and benefits ordinary bounties too.

There are NO chunks, leases, buckets, or Merkle trees in prize mode — the
submission surface is open (anyone, anytime before deadline). This keeps W1
scope honest; the chunked/paid-per-generation variant is Spec 03.

## 2. Module ABI (candidate-evaluating modules)

```
evaluate_candidate(cand_ptr, cand_len: i32, params_ptr, params_len) -> i64  // fitness; INT64_MIN = error
candidate_max_len() -> i32          // upper bound the host enforces (e.g. 65536)
spec_version() -> ptr
```
- New optional export `bounty_mode() -> i32` is NOT needed — prize-ness is a
  JOB property, not a module property. A module qualifies for prize bounties
  iff it exports `evaluate_candidate`; the registry records
  `supports_candidates bool` at upload (derived from exports, like Spec 01's
  mode). The same module MAY also export the extremum ABI (dual-use).
- Determinism contract identical (fixed-point/integer math, conformance gate
  §6). The fitness function IS the whole module for the demo.

## 3. Data model (same migration file as Spec 01 or a sibling)

```sql
alter table jobs add column bounty_kind text not null default 'coverage'
  check (bounty_kind in ('coverage','prize'));
alter table jobs add column prize_lamports bigint;
alter table jobs add column threshold_score bigint;     -- minimum fitness to win
alter table jobs add column deadline_at timestamptz;
alter table jobs add column prize_winner_id uuid references users(id);
alter table jobs add column prize_awarded_at timestamptz;
alter table worker_specs add column supports_candidates boolean not null default false;

create table candidate_submissions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  worker_id uuid not null references users(id),
  candidate bytea not null,                  -- ≤ candidate_max_len
  claimed_score bigint not null,
  verified_score bigint,                     -- null until re-evaluated
  state text not null default 'pending' check (state in ('pending','verified','rejected')),
  signature text not null,                   -- worker ed25519 over canonical bytes
  submitted_at timestamptz not null default now(),
  verified_at timestamptz
);
create index on candidate_submissions (job_id, verified_score desc);
```
`candidate_submissions` ships with `enable row level security` and **NO
read policy** (review catch: the sketch above without RLS would expose
pre-reveal genome bytes via Supabase PostgREST, defeating §7 entirely —
same convention as `honeypots`/`result_rejections`; all reads go through
coordinator endpoints only).

Pricing rule change in `jobs.ts`: the existing guard at jobs.ts:117-119
(`else if (budget > 0) throw "a budget requires a price per chunk"`)
REJECTS the prize shape outright — the prize branch must run BEFORE that
guard (review catch; easy to lose in the migration day). For
`bounty_kind='prize'`: `price_per_chunk_lamports = 0`,
`budget_lamports = prize_lamports > 0`, `threshold_score` and `deadline_at`
required, deadline ≥ 1h ahead. Escrow funding flow (draft → initialize_job
→ /funded verify → open) reused verbatim — budget == prize.
Chunks/honeypots generation is SKIPPED for prize jobs (early return in
`createJob` before the chunk loop).

**Per-job params salt (review-critical fix for cross-job genome reuse):**
`createJob` for prize jobs FORCES `params.start_state_seed =
u64(sha256(job_id)[0..8])` (overwriting any funder-supplied value). Without
this, a genome revealed at one job's close wins every later job sharing
(module, params) with zero training — the review's exploit #3. With it,
fitness landscapes differ per job and genomes don't transfer. The /train
page reads the effective params from the job, so local training always
targets the right landscape.

## 4. Coordinator

### Submission path (new)
`POST /v1/candidates` `{ job_id, candidate_b64, claimed_score, nonce,
signature }` (signature: worker key over canonical bytes; same
`verifyResultSignature` pattern; rate-limit per wallet, e.g. 30/min):
1. Job must be open prize-kind, before deadline; candidate ≤ module's
   `candidate_max_len`.
2. Verify immediately (cheap): `mod.evaluateCandidate(bytes, paramsJson)`
   in a **SEPARATE bounded evaluation queue/thread** (review fix: sharing
   the bucketPool would let a wallet-rotated submission burst starve
   challenge judging for every job — a DoS surface). Same 8s-timeout
   hostile-module protection pattern, its own single thread, queue capped
   (e.g. 64; overflow → 429).
   `verified_score` recorded; mismatch with `claimed_score` → state
   `rejected` (opaque to submitter, consistent with rejection policy).
   NOTE: unlike chunk results there is NO slash (no stake required to
   submit) — cost of junk = rate limiting only. Rate limit **IP + wallet
   jointly** (review: per-wallet alone is free to rotate); a per-identity
   proof-of-work or micro-stake is the roadmap answer, documented not
   built. The oracle-guided-search freeloader is bounded by the same
   limits. Fitness evaluation must stay cheap (<~100 ms); conformance
   enforces.
3. If verified and beats the job's current best → update
   `current_record_score/current_record_seed`-ANALOG: reuse the existing
   columns? NO — keep prize state separate: best is `max(verified_score)`
   by index; SSE event `candidate_verified { job_id, score }`.
4. Leaderboard endpoint `GET /v1/jobs/:id/candidates` (top N verified, no
   candidate bytes until job closes — anti-sniping, see §7).

### Finalization (sweeper)
On `now() >= deadline_at` for an open prize job (new sweeper step,
explorer-confirmed the sweeper is the right home):
- Winner = highest `verified_score > threshold_score`; tie → earliest
  `submitted_at` (priority = first to reach the mark; document it).
- Winner exists: upsert `earnings (worker_id, job_id) cumulative_lamports =
  prize_lamports`; set `prize_winner_id/prize_awarded_at`; `status='closed'`;
  SSE `prize_awarded`; notify winner and funder. **Claims-UI fix (review):**
  `GET /v1/claims` currently filters `price_per_chunk_lamports > 0`
  (routes.ts:173) which hides prize winnings from /account entirely —
  change the filter to `cumulative_lamports > claimed_lamports` so the
  winner actually sees the claim button. The voucher/claim flow itself
  works unchanged.
- No winner: `status='closed'`, notify funder "reclaim your escrow"
  (close_job button, §5). Candidates become publicly readable on close.
- On-chain attestation of the win: call the existing `record_find` with
  `seed = sha256(candidate)[0..8] as u64` and `score = verified_score` —
  attribution PDA semantics hold (job, digest-as-id, score, finder). This
  keeps "every win is attributed on-chain" TRUE for prize bounties with zero
  program changes. Document the seed-is-a-digest convention in the audit
  endpoint text.

### close_job — REVIEW-CRITICAL: the deployed instruction is unguarded
The adversarial review proved the earlier "funder-only, no co-sign, wire it
as-is" draft is exploitable — and worse, the exploit exists TODAY on devnet
independent of any UI: `close_job` (`lib.rs:198-203, 327-341`) requires only
the funder's signature (`has_one = funder, close = funder`). A prize funder
can watch the public leaderboard/SSE and sweep the entire escrow the moment
a worker approaches `threshold_score` — before deadline, before award. It
also lets any coverage funder strand credited-but-unclaimed earnings
mid-job.

**Fix (the month's ONE program change, overriding the no-program-changes
default — owner sign-off in 90-decisions.md):** upgrade `close_job` to
require the coordinator as co-signer (mirror `Slash`'s
`has_one = coordinator` pattern). The coordinator co-signs a close only
when its DB says the job is closed AND (no prize pending OR prize awarded
and claimed/expired). Program is upgradeable, we hold authority, devnet
redeploy is a rehearsed path. ~30 lines of Rust + redeploy + the byte-exact
co-sign route (same pattern as claims).
- `packages/chain`: `closeJobIx` builder (+ discriminator) + unit test.
- Route `POST /v1/jobs/:id/close-funding`: browser builds + signs,
  coordinator verifies byte-exact against its own expected instruction and
  co-signs (claims-flow pattern reused).
- Web: "Reclaim unspent budget" button for the funder on closed jobs (both
  bounty kinds — coverage escrows also leak dust today).
- Until the upgrade lands, prize bounties are OWN-FUNDED only (we would be
  the only party able to exploit ourselves) — do not market prize bounties
  to external funders before the program upgrade ships.

## 5. Web

- `/bounties/new`: bounty-kind toggle (Coverage | Prize). Prize form: prize
  SOL, threshold, deadline picker. Econ panel becomes "prize · threshold ·
  time remaining" (no chunk math).
- `/bounties/[id]` prize variant: countdown, verified-submission leaderboard
  (scores + workers, no genomes), threshold line, winner banner post-award.
- `/contribute` does NOT serve prize jobs (no chunks). Instead:
- **`/train/[jobId]` — the demo page**: loads the module WASM in the
  browser, runs a local GA loop (host-side JS: population, mutation,
  crossover — the module only scores), live-renders the best agent playing
  (see §8), and has a "Submit best" button that signs + POSTs the genome.
  This page is the W1 X clip and the pitch-video centerpiece precursor.

## 6. Conformance gate (candidate modules)

For modules exporting `evaluate_candidate`: evaluate a fixed pseudo-random
set of 16 candidates (seeded bytes) TWICE → identical scores; each call
under 100 ms in the gate thread; `candidate_max_len` within [32, 65536].
Dual-ABI modules run both gate suites.

## 7. Anti-sniping (pocket answer, minimal build)

Submissions' candidate bytes are hidden until close (DB policy + endpoint
shape); scores are public. A sniper cannot steal a genome they cannot see.
Copying the *score* is useless (they must produce bytes that reproduce it).
Full commit-reveal is roadmap; document in the audit text. (Vault:
Evolutionary and Optimization Compute §objections.)

## 8. The "AI learns" demo module (`packages/worker-core-evo/`)

Pick (OWNER-RATIFIED 2026-09-11): **flappy-bird-style side-scroller** —
built directly, no cart-pole intermediate. Bird physics + pipe course in
integer fixed-point; the course layout derives from the seeded PRNG, so the
per-job params salt gives every job a different course (nice property: the
anti-genome-reuse fix is VISIBLE — a champion bird from one job crashes on
another job's course). Spec below adjusted accordingly:
- Physics in i32 fixed-point (×1024 scale); NO floats anywhere. Bird:
  gravity + flap impulse; inputs to the net: bird y, y-velocity, next two
  pipe gaps (dx, dy) — 5 or 6 values.
- Genome: small MLP, e.g. 6→8→1 (flap threshold) weights as i16 array ≈
  120 bytes. Population and evolution live in HOST JS on /train (module
  stays a pure scorer).
- `evaluate_candidate` runs up to S=3000 sim ticks, fitness = pipes passed
  × 1000 + ticks survived (i64). Deterministic by construction (integer
  physics; the pipe course is generated from the seeded counter-PRNG).
- Params: `{ sim: "flappy-v1", course_seed: <forced per-job salt>,
  max_ticks: 3000, gap_px: ..., speed: ... }`.
- Browser replay: the /train page reimplements the RENDERING only (canvas
  drawing from a state trace); to avoid double-implementation drift, the
  module also exports `trace_candidate(cand, params, out_ptr, cap) -> len`
  emitting the state sequence (positions per tick) that the canvas draws —
  the sim runs ONLY inside the module, in WASM, deterministically.
- Registered as builtin #5; `is_builtin`, public.

## 9. Sequencing (4 days)

| Day | Deliverable (deployed daily) |
|---|---|
| 4 | Migration (bounty_kind + candidate_submissions); jobs.ts prize branch; candidate submission route + thread-pool evaluateCandidate; conformance suite. |
| 5 | Sweeper finalization + prize attestation + SSE; claims regression (prize award → voucher → devnet claim E2E with a test wallet); claims-list filter fix. close_job program upgrade + builder + co-sign route + reclaim button IF the day has room, else it is the FIRST W2 buffer item (prize bounties stay own-funded until it lands). |
| 6 | Evo module (C, fixed-point sim + trace export) + conformance pass; /train page with local GA loop + canvas replay. |
| 7 | Prize bounty funded on prod against the evo module; leaderboard + countdown UI polish; X clip (agent visibly improving); buffer/regressions. |

## 10. Risks

- **Fitness eval cost ceiling**: 1000 sim steps × tiny MLP ≈ fast; enforce
  <100 ms in conformance so `POST /v1/candidates` stays synchronous-cheap.
- **Free-riding the coordinator as an eval oracle** (submit junk to learn
  scores): verified_score is returned to the submitter — that's a feature
  (honest eval service) but rate-limit guards abuse.
- **Attestation seed convention** (digest-as-u64) must be documented or a
  judge reading the explorer sees "seed" for a genome; the finds UI should
  label prize attestations "candidate digest."
- Dockerfile filter list: add `worker-core-evo`.
- Trailing risk from Spec 01 shared migration ordering — land as one
  migration or strictly ordered pair.

## 11. Decisions taken by default

- Prize-ness = job property; candidate support = module capability. Dual-ABI
  allowed.
- Immediate synchronous verification of every submission (no sampling) —
  it's one cheap call; simplest honest design.
- Tie-break = earliest submission. Anti-sniping = hidden bytes until close.
- Prize attestation reuses record_find with digest-as-seed (no program
  change this month).
