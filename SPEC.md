# SIEVEWORKS — Full Build Specification

You are helping me build and ship Sieveworks solo in 7 days. Demo day is
August 31, 2026, in front of hackathon judges who weight shipped products over
prototypes. Bias hard toward working vertical slices over completeness. When
something won't fit in the time remaining, say so immediately rather than
half-building it.

## 1. WHAT SIEVEWORKS IS

An exchange for verifiable search. Someone funds a brute-force search job with
a budget. Contributors run chunks of the search space on their own hardware —
in the browser via WebAssembly, or via a native CLI — and get paid per verified
chunk on Solana. Every discovery is permanently and unforgeably attributed
on-chain to whoever found it.

Launch vertical is Minecraft seedfinding. The platform itself is
GAME-AGNOSTIC: it knows how to split a numeric search space, distribute
ranges, verify results, settle payment, and attribute finds. It does not know
what Minecraft is. Each community supplies its own worker binary conforming to
our protocol.

The class of problem we serve: HARD TO FIND, EASY TO CHECK. A compact input,
deterministic evaluation, and a witness anyone can verify in microseconds.
Every design decision must preserve cheap verification — it is the entire
source of our advantage.

## 2. THE VERIFICATION DESIGN — THE CORE IP

Read this section twice. It is why the project is defensible.

THE PROBLEM: in a search task, "I searched my chunk and found nothing" is both
the honest answer and the free cheater's answer. A negative result proves no
work was done. The industry-standard fix is redundant execution — hand each
chunk to 2-3 workers and compare — which multiplies buyer cost by 2-3x. We are
not doing that.

Five layered mechanisms:

### 2.1 Extremum reframing
Jobs NEVER ask yes/no questions. A job asks: "what is the highest-scoring seed
in this range, and what is its score?" Every chunk returns a value plus a
witness seed that must actually produce that value. Verification = regenerate
one seed. There is no fakeable "nothing found" answer because the honest answer
to every chunk is a specific positive claim.

Secondary signal: chunk maxima follow a predictable distribution per job. Track
the running distribution and flag workers whose submissions drift from it
across many chunks, even when no individual result is provably wrong.

### 2.2 Merkle commit-and-challenge
The worker partitions its chunk into BUCKETS of `bucket_size` seeds (default
1024). For each bucket it computes the bucket's max score and the seed that
produced it. Leaf = hash(bucket_index, bucket_max_score, bucket_max_seed). It
builds a Merkle tree over all bucket leaves and submits ONLY the root along
with the chunk extremum and witness.

The coordinator then challenges N random bucket indices (default 8). The worker
must return those leaves with inclusion proofs. The coordinator recomputes
those 1024-seed buckets itself and checks the leaf matches. A worker cannot
open a leaf it never computed.

Bucket-level leaves (not per-seed) keep the tree small enough to build in a
browser and keep challenge verification cheap.

### 2.3 Honeypot seeds
The platform maintains a table of precomputed seeds with known scores,
scattered across the search space. NOTHING is injected into the assignment —
these are simply seeds the coordinator already knows the answer for.

When a result arrives, check whether the chunk range contains any known seed
whose score exceeds the reported extremum. If so, the worker did not search
that range. Undetectable by the worker because the assignment is unmodified.

This catches under-reporting; witness verification catches over-reporting.
Together both directions are covered.

### 2.4 Stake and slash
Workers post a small bond before receiving paid work. Detected cheating burns
it. Target ~5% random audit rate on top of honeypot coverage. Combined, this
makes cheating negative expected value without blanket redundancy.

### 2.5 Deterministic re-verification of records
Every claimed new record is independently recomputed by the coordinator before
being credited and written on-chain. Finds are rare, so this is nearly free.
It also catches honest errors — buggy clients, stale builds, version
mismatches — which are a real fraction of failures and have nothing to do with
malice.

### 2.6 Why this is defensible
This is a PROBLEM-FRAMING result, not a cryptographic one. Generic compute
networks (io.net, Nosana, Render, Akash) accept arbitrary jobs and cannot
reframe them into extremum searches, so they must fall back on redundancy or
trusted execution. We serve one workload family and understand its shape.

## 3. DETERMINISM — NON-NEGOTIABLE

THE COORDINATOR VERIFIES USING THE SAME WASM MODULE THE WORKERS RUN.

Do not build a separate native verifier. The coordinator loads the identical
`.wasm` artifact (by content hash) that browser workers execute, runs it under
Node, and uses it for all witness checks, challenge recomputation, and honeypot
generation. The coordinator only ever evaluates single seeds or single 1024-seed
buckets, so its throughput is irrelevant. This makes worker/verifier drift
impossible by construction.

Additional requirements:
- Every job pins `worker_spec_hash` = sha256 of the exact WASM artifact.
- A result submitted with a different `worker_spec_hash` than the job's is
  rejected outright, not verified.
- Minecraft world generation differs across game versions — every job pins a
  `version_pin` string that is passed into the worker params.
- Day 1 deliverable: a determinism test asserting the native CLI build and the
  WASM build produce identical output over a fixed seed range and fixed
  params. If they ever diverge, the native CLI is wrong, not the WASM.

## 4. STACK

- pnpm + Turborepo monorepo, TypeScript everywhere except the worker core.
- apps/web — Next.js App Router, Tailwind, shadcn/ui. Deploys to Vercel.
  Landing, bounty board, job detail, job creation, browser worker, leaderboard,
  finds feed, contributor profiles, docs.
- apps/coordinator — Fastify, long-running, deploys to Fly.io. Chunk
  allocation and leasing, result ingestion, the full verification pipeline,
  voucher signing, SSE. THIS CANNOT BE SERVERLESS.
- packages/worker-core — C. Thin wrapper around cubiomes. Two build targets:
  native CLI and WASM via Emscripten.
- packages/protocol — TypeScript. Zod schemas for the worker protocol, shared
  by browser, CLI, and coordinator. This is the platform's public interface.
- packages/wasm-runtime — TypeScript. Loads and drives the WASM module. Used
  by both the browser worker and the coordinator's verifier.
- packages/ui — design tokens and shared components.
- programs/sieveworks — Anchor program.
- Supabase Postgres with RLS. Upstash Redis for leases, heartbeats, rate
  limits, live counters.

BEFORE USING CUBIOMES: report its license to me and wait for confirmation.
Wrap it — never reimplement world generation. If you find yourself reading
Minecraft generation internals, stop and tell me.

## 5. THE WORKER PROTOCOL

This is the abstraction that makes the platform game-agnostic. Design it
carefully; everything else is replaceable.

### Chunk assignment (coordinator → worker)

```
{
  chunk_id: uuid,
  job_id: uuid,
  worker_spec_hash: string,   // sha256 of required WASM artifact
  range_start: string,        // u64 as decimal string (JS number is unsafe)
  range_end: string,          // exclusive
  bucket_size: number,        // default 1024
  params: object,             // opaque, job-specific, passed to worker
  lease_expires_at: iso8601,
  nonce: string
}
```

### Result submission (worker → coordinator)

```
{
  chunk_id: uuid,
  worker_spec_hash: string,
  extremum_score: number,
  witness_seed: string,       // u64 as decimal string
  merkle_root: string,        // hex
  buckets_count: number,
  seeds_evaluated: string,
  duration_ms: number,
  nonce: string,              // echoed
  signature: string           // worker wallet signs canonical JSON of above
}
```

### Challenge (coordinator → worker) and response

```
{ result_id: uuid, bucket_indices: number[] }

{
  result_id: uuid,
  leaves: [{ index, max_score, max_seed }],
  proofs: string[][]          // sibling hashes per leaf
}
```

The worker MUST retain its bucket data until the challenge is answered.
Challenges are issued within seconds of submission; a worker that cannot answer
within the timeout fails the chunk.

### Worker interface (what a new community must implement)
A conforming worker is a WASM module exporting:

```
evaluate_range(range_start: u64, range_end: u64, params_ptr, params_len)
  -> writes to a result buffer: per-bucket (max_score, max_seed)
evaluate_seed(seed: u64, params_ptr, params_len) -> score
spec_version() -> string
```

`evaluate_seed` is what the coordinator uses for verification. Both must be
deterministic and pure.

## 6. DATA MODEL

Write migrations before the code that uses them.

```
users(id, wallet_address unique, display_name, created_at)

jobs(id, creator_id, title, description, game, worker_spec_hash, version_pin,
  params jsonb, search_space_start numeric(20,0), search_space_end numeric(20,0),
  chunk_size bigint, bucket_size int, budget_lamports bigint,
  price_per_chunk_lamports bigint, escrow_pda text, status,
  current_record_score, current_record_seed, created_at, closed_at)

chunks(id, job_id, range_start numeric(20,0), range_end numeric(20,0), state,
  leased_to, leased_at, lease_expires_at, attempts int, created_at)
  -- state: pending | leased | submitted | verifying | accepted | rejected
  -- index on (job_id, state)

results(id, chunk_id, worker_id, extremum_score, witness_seed numeric(20,0),
  merkle_root, buckets_count, seeds_evaluated numeric(20,0), duration_ms,
  signature, verification_state, rejection_reason, submitted_at, verified_at)
  -- verification_state: pending | witness_ok | challenged | passed | failed

challenges(id, result_id, bucket_indices int[], response jsonb, passed bool,
  issued_at, responded_at)

honeypots(id, job_id, seed numeric(20,0), score, created_at)
  -- index on (job_id, seed)

finds(id, job_id, worker_id, seed numeric(20,0), score, is_record bool,
  tx_signature, attested_at, created_at)

worker_stakes(id, worker_id, amount_lamports, state, stake_pda, slashed_at,
  created_at)

earnings(id, worker_id, job_id, cumulative_lamports, last_voucher_nonce,
  last_voucher_sig, claimed_lamports, updated_at)
  -- unique(worker_id, job_id)
```

Use numeric(20,0) for u64 values — never JS numbers, never bigint columns you
then read into JS numbers. Serialize as decimal strings across the wire.

## 7. CHUNK ALLOCATION AND LEASING

- Redis holds the active lease: `lease:{chunk_id}` with TTL. Postgres is the
  source of truth for state.
- On lease expiry, the chunk returns to `pending`. Increment `attempts`.
- A chunk with `attempts > 5` is quarantined for manual review — it usually
  means the chunk crashes the worker.
- Allocation prefers `pending` chunks in ascending range order so progress is
  visually contiguous on the swarm view. That matters for the demo.
- Rate limit lease requests per wallet and per IP.
- Never lease paid work to a wallet with no active stake.

## 8. VERIFICATION PIPELINE

State machine, executed by the coordinator on submission:

1. Reject if `worker_spec_hash` ≠ job's. Reject if nonce mismatch, signature
   invalid, or lease expired.
2. WITNESS CHECK — run `evaluate_seed(witness_seed, params)` in the WASM
   verifier. Must equal `extremum_score`, and `witness_seed` must lie inside
   the chunk range. Fail → reject + slash.
3. HONEYPOT CHECK — query known seeds in range. If any known score >
   `extremum_score`, the worker skipped work. Fail → reject + slash.
4. CHALLENGE — with probability = audit_rate (default 5%, forced to 100% for a
   worker's first 3 chunks and any chunk claiming a new record), issue a
   challenge for 8 random buckets. Recompute each bucket via the WASM verifier,
   verify inclusion proofs against the submitted root. Fail → reject + slash.
5. ACCEPT — mark accepted, credit `earnings.cumulative_lamports +=
   price_per_chunk`, emit SSE.
6. RECORD PATH — if `extremum_score` > job's `current_record_score`,
   re-verify deterministically, update the job record, write the on-chain
   attestation, insert into `finds`, emit SSE.

Every rejection records a reason. Expose an audit endpoint that returns
everything needed for a third party to independently re-verify any decision —
this is the honest answer to "your coordinator is centralized."

## 9. SOLANA LAYER

Anchor program `sieveworks`. Devnet by default, mainnet by one env var.

### Accounts
- `JobEscrow` PDA: seeds [b"job", job_id]. Holds budget, records
  price_per_chunk, authority (coordinator pubkey), funder, total_paid.
- `WorkerStake` PDA: seeds [b"stake", worker_pubkey]. Amount, state.
- `FindRecord` PDA: seeds [b"find", job_id, seed_le_bytes]. job, seed, score,
  finder, slot. THIS IS THE ATTRIBUTION PRIMITIVE.

### Instructions
- `initialize_job(job_id, budget, price_per_chunk)` — funder deposits.
- `stake(amount)` / `unstake()` — worker bond, unstake subject to cooldown.
- `claim(job_id, cumulative_amount, nonce, coordinator_sig)` — worker submits
  a coordinator-signed voucher; program pays `cumulative_amount - already_paid`
  and stores the new total. Monotonic cumulative amounts make replay
  impossible.
- `record_find(job_id, seed, score, finder)` — coordinator-signed, creates the
  attribution PDA. Idempotent on (job_id, seed).
- `slash(worker, amount)` — coordinator-signed.
- `close_job(job_id)` — funder reclaims unspent budget.

### Build order and risk
`record_find` FIRST — it is cheap and it is the "why blockchain" argument.
Escrow and vouchers second. TIMEBOX the Anchor work to ONE DAY. If it is not
working by end of Day 4, tell me and fall back to a clearly-labelled devnet
coordinator-held wallet, keeping `record_find` on-chain regardless. Put every
payout call behind a `PaymentRail` interface so the swap is config.

I have not written a production Anchor program before. Explain each account
constraint you use and why.

## 10. THE WORKER — BROWSER AND NATIVE

### Browser (the onboarding path and the demo)
- cubiomes compiled to WASM via Emscripten.
- Spawn N independent Web Workers, each with its own WASM instance, each
  handling a sub-range. DO NOT use SharedArrayBuffer or Emscripten pthreads —
  they require COOP/COEP cross-origin isolation headers which complicate Vercel
  deployment. Independent instances are simpler and fast enough.
- Default N = `navigator.hardwareConcurrency - 1`, user-adjustable.
- The page must stay responsive at all times. Show live seeds/sec, current
  chunk, session earnings, and buckets completed.
- Persist bucket data in memory until the challenge is answered.
- Target: a judge connects a wallet and starts contributing in under 15
  seconds, no install.

### Native CLI
- Same C core, native build. `sieveworks-worker --job <id> --wallet <keypair>`.
- For contributors who want real throughput.
- Must produce byte-identical results to WASM (enforced by the Day 1 test).

## 11. WEB APP SURFACE

- `/` — landing. Live swarm view is the hero: active contributors, chunks
  completing in real time, global seeds/sec, recent finds ticker. Real data
  from SSE only; if empty, show honest zeros, never fabricated activity.
- `/jobs` — bounty board. Job cards: title, game, budget remaining, price per
  chunk, progress bar, active workers, current record.
- `/jobs/[id]` — job detail. Progress, leaderboard of contributors, finds
  history, current record, and a prominent Contribute button.
- `/jobs/new` — create a job: pick worker spec, define search space, params,
  budget, price per chunk. Fund via wallet.
- `/contribute` — the worker runner UI.
- `/finds` — global feed of verified discoveries with explorer links.
- `/workers/[wallet]` — contributor profile: chunks completed, total earned,
  finds attributed. This is the reputation surface.
- `/docs` — how to contribute, and how to write a worker for a new community.

## 12. DESIGN DIRECTION

A distributed computing console for a technical community. Reference points:
BOINC and mission-control telemetry, rendered with modern craft. NOT
crypto-gradient, NOT glassmorphism, NO purple.

- Monospace with tabular figures for EVERY number: seeds, scores, hashes,
  throughput, counts. This single rule carries the identity.
- Dense information display. Small type, real data, lots per screen.
- Motion only on data change — new results flash and settle. Nothing else
  animates. No scroll reveals.
- One accent colour. Green and red reserved strictly for verified and rejected.
- Skeleton loaders matching final layout, never centred spinners.
- Zero cumulative layout shift.
- Every seed, wallet, and signature is truncated, copyable, and links to the
  Solana explorer on the correct cluster.

## 13. WHAT NOT TO BUILD

No teams or orgs, no RBAC, no email, no admin panel, no i18n, no mobile app,
no arbitrary query language for search filters, no job templates, no worker
sandboxing beyond WASM's own. Ship TWO hardcoded Minecraft searches. If you
find yourself building a query engine or a plugin system, stop and tell me.

## 14. SEVEN-DAY SCHEDULE

Day 1 (Aug 24) — Monorepo, Supabase schema + migrations, wallet auth. Wrap
cubiomes; native + WASM builds; determinism test passing. Deploy skeletons of
web and coordinator. End the day deployed.

Day 2 (Aug 25) — Worker protocol package. Chunk allocation and leasing.
Result ingestion. Native CLI worker completing chunks end to end against the
deployed coordinator. No verification, no payments yet.

Day 3 (Aug 26) — The full verification pipeline: witness check, Merkle
commit-and-challenge, honeypots, audit sampling, slashing decisions. PROTECT
THIS DAY. This is the product.

Day 4 (Aug 27) — Anchor program. `record_find` first, then stake, escrow, and
claim vouchers. Timeboxed — fall back if incomplete by end of day.

Day 5 (Aug 28) — Browser WASM worker. Multi-threaded via independent Web
Workers, live stats, wallet connect, contribute in under 15 seconds.

Day 6 (Aug 29) — Bounty board, job creation, job detail, leaderboard, finds
feed, live swarm view, SSE wiring. Design pass. Post a real bounty for a
search the Minecraft community actually wants run.

Day 7 (Aug 30) — FEATURE FREEZE. Load test with real machines. Demo script.
Backup video. Rehearse standing up, out loud, five times minimum.

Aug 31 — Demo.

## 15. THE DEMO — DESIGN TOWARD THIS FROM DAY 1

Post a bounty. Laptops in the room join from the browser in seconds. The swarm
view fills live, chunks completing, seeds/sec climbing. Someone hits a record —
it is deterministically verified and written on-chain, permanently attributed
to them, explorer link on screen. Then submit a fabricated result from a
scripted client and watch the honeypot catch it and slash the stake.

If a feature does not appear in that sequence, it is cut.

## 16. GROUND RULES

- Every day ends deployed and working end to end. Never leave me overnight with
  a half-finished vertical slice.
- Write the migration before the code that needs it.
- When a decision has real tradeoffs, present options with a recommendation and
  let me pick. Do not silently choose.
- Tell me plainly when something will not fit in the time remaining.
- I will give you each day's goal at the start of that day. Do not attempt to
  build the whole thing at once.
- No Minecraft assets, textures, or trademarks. No implication of Mojang
  affiliation.

## DAY 1 TASK

1. Report the cubiomes license and wait for my confirmation.
2. Propose the full repo tree with a one-line purpose per package.
3. Propose the initial migration.
4. Propose the worker protocol zod schemas in packages/protocol.

Wait for my approval on all four before writing implementation code.
