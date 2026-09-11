# Spec 03b — Fraud-proof (bisection) verification for training

Status: DESIGN (owner-ratified direction, Sep 11 2026). Supersedes the
verification *guarantee* of Spec 03; the mechanics of Spec 03 (lineages,
rolling chunks, bucket commitments) are reused wholesale.

Interim until this ships: Spec 03's probabilistic 10% audit + slow-lane
re-audit stays live, with copy that says training carries *probabilistic*
verification today and interactive fraud proofs are the roadmap.

---

## 1. Why (the problem this and only this solves)

Training is **sequential**: a chunk is 256 buckets × 32 generations = 8192
deterministic GA generations, each bucket state a pure function of the previous
one. The worker delivers the final state `S₂₅₆`, which becomes the lineage's
`latest_state` — **the origin every future worker on that lineage builds on.**

Spec 03 verifies that the delivered state matches the worker's *own*
commitment (final-leaf Merkle inclusion + salted digest). It does **not** verify
that the state is the true result of running the GA forward from the lineage's
real origin. A worker can commit a self-consistent *fabricated* chain, deliver a
state matching their own commitment, pass, collect payment, and **poison the
origin for every honest successor** (audit finding #6). The slow-lane re-audit
catches this only probabilistically and *after the fact* — the flag is a record,
not a prevention, and it collects nothing once the worker has unbonded.

Verifying sequential computation *cheaply* is the hard part. Three known
families (see `plans/cwf/90-decisions.md` D4 for the full trade table):

- **Re-execution** — coordinator re-runs every chunk. Correct, 100% overhead,
  kills training economics.
- **zk-SNARK / zkVM** — worker proves the chain. Unconditionally sound,
  non-interactive, but taxes the *prover* 10³–10⁶×. Self-defeating for a
  compute marketplace whose value is cheap compute.
- **Interactive fraud proofs (bisection)** — this spec. Worker pays ~nothing
  extra; disputes are settled by re-running **one bucket**; verdict is
  objective and public. Precedent: TrueBit, Arbitrum, Optimism-Cannon.

The bisection game's asymmetry is the whole point: **verify an 8192-generation
computation by re-running 32 generations.**

---

## 2. Trust model & goal

Replace "the coordinator's word decides training payouts" with "**any single
honest party can force an objective, publicly-recomputable verdict.**"

- **Soundness** rests on: (a) the determinism of `advance_bucket` (already an
  invariant — zero-drift WASM), and (b) ≥1 honest challenger existing and being
  online within the window. The coordinator is the *default* challenger, so the
  assumption degrades gracefully to today's model and improves the moment any
  third party watches. Because resolution is objective, one honest challenger
  with the correct re-execution beats a lying majority — strictly less trust
  than the status quo.
- **Non-goal (v1):** removing the challenge window / instant finality; removing
  the honest-watcher assumption entirely (that needs zk, explicitly rejected);
  fully-on-chain step execution (see §7 feasibility tiers).

---

## 3. What's reused from Spec 03 (no change)

- The module ABI: `init_state(lineage_seed) → S₀`, `advance_bucket(Sᵢ) → Sᵢ₊₁`
  (bit-exact; one bucket = 32 generations), `best_of_state(S) → (score, genome)`.
- Lineages, island model, rolling chunks, `chunks`/`lineages` tables.
- The per-bucket salted digest `bucketDigest16(salt, state)` and the Merkle tree
  over the 256 bucket digests (`merkle_root` on the result). The commitment the
  worker already makes IS the trace commitment the game needs — no extra prover
  work. This is the crux of "worker pays ~nothing."

---

## 4. The commitment (make the trace explicit)

Today the leaf is `digest16(Sᵢ₊₁)` for bucket i. For bisection we need the game
to reference **both endpoints** of every bucket transition. Redefine the leaf as
the *transition* i:

```
leaf_i = H( i ‖ digest(S_i) ‖ digest(S_{i+1}) )          for i in [0, 256)
merkle_root = MerkleRoot(leaf_0 … leaf_255)
```

- `S_0` is pinned: it must equal the lineage origin — either
  `init_state(lineageSeed32(job, lineage))` for the lineage's first chunk, or
  the *previous confirmed chunk's* `S_256` (origin anchoring, on-chain-bound in
  §6). The worker also publishes `digest(S_0)` in the assertion; the program
  checks it equals the anchored origin digest.
- `digest(S_256)` is the delivered `latest_state` candidate.
- Data availability: the worker must retain all `S_0…S_256` (256 × state-bytes)
  to answer bisection queries. Failure to answer within a step timeout =
  loses by default. This is bounded, small storage.

`digest()` is the existing 16-byte salted bucket digest, so state bytes never
go on-chain; only digests + Merkle openings do.

---

## 5. The bisection game (off-chain protocol, on-chain settlement)

Actors: **Asserter** = the worker who delivered the chunk. **Challenger** =
anyone (coordinator by default) who re-ran the chunk and disagrees.

### 5.1 Assert
On delivery the worker posts an **Assertion**: `(chunk_id, merkle_root,
digest(S_0), digest(S_256), n_buckets=256)` and locks an **asserter bond**. The
chunk enters `unconfirmed`. Payment and use-as-origin are withheld (§6).

### 5.2 Open challenge window
For `CHALLENGE_WINDOW` (see §8) anyone may open a **Dispute** by locking a
**challenger bond** and naming the transition index where *their* honest
re-execution first diverges (`digest(S_k)` agrees, `digest(S_{k+1})` differs).
No dispute by window close ⇒ chunk **confirmed** (§6).

### 5.3 Bisect (log₂ 256 = 8 rounds)
Classic interactive bisection over `[lo, hi)` (initially `[0, 256)`), the two
parties alternately pinning the midpoint:
- Asserter opens `digest(S_mid)` with a Merkle proof against `merkle_root`.
- Challenger declares agree/disagree at `mid`; the disputed half becomes the new
  interval.
- Repeat until `hi - lo == 1`: a **single bucket i** where both agree on
  `digest(S_i)` and disagree on `digest(S_{i+1})`.

Each message is one Solana instruction updating an on-chain **Dispute** account
(interval, whose turn, deadline). A party that misses its `STEP_TIMEOUT` loses
by default (liveness resolution). ~16 instructions total per dispute (8 rounds ×
2). Cheap.

### 5.4 One-step resolution — the referee
Now the disputed unit is exactly one `advance_bucket(S_i) → S_{i+1}`, with
`digest(S_i)` agreed. The referee re-runs **that one bucket** and compares
`digest(advance_bucket(S_i))` to each party's claimed `digest(S_{i+1})`:

- The party whose claim matches wins; the other is slashed (bond → winner +
  incinerator split, §8) and their chunk is **rejected** (never becomes origin).
- If the asserter loses, the poison never lands: `latest_state` was never
  confirmed, and their worker bond is additionally slashable (this IS a proven
  cheat — reuse the burn-on-slash path).

Who runs the referee, and where, is the feasibility question — §7.

---

## 6. Finality & the origin chain (the sequential-dependency knot)

The successor chunk's origin = this chunk's `S_256`. We must not let an
unconfirmed (possibly poisoned) state seed the next worker.

**v1 — window-gated finality (safe, simple):** a chunk's `S_256` becomes the
lineage's canonical `latest_state`, the successor chunk is rolled, and payment
is released, **only after `CHALLENGE_WINDOW` closes with no successful
dispute.** Cost: lineage progress is serialized by the window length. Mitigate
by (a) short windows when the coordinator is the sole challenger, (b) many
parallel lineages so throughput ≠ latency.

**v2 — optimistic chaining (throughput, deferred):** allow successors to build
on unconfirmed states; a successful dispute triggers a **cascading rollback** of
the poisoned suffix (re-lease from the last confirmed state). More complex,
more like a rollup. Not in v1.

Origin anchoring is enforced on-chain: the Assertion's `digest(S_0)` must equal
the lineage's confirmed `latest_state` digest, stored in a **Lineage** PDA
`(job_id, lineage_idx) → { confirmed_state_digest, generations_confirmed }`.
This makes the whole lineage a hash chain rooted at
`init_state(lineage_seed)` — a worker cannot start from a fabricated origin.

---

## 7. Feasibility tiers for the referee (the honest hard part on Solana)

The referee must re-run one `advance_bucket` = 32 GA generations over the whole
population. **This does not fit in a Solana instruction's compute budget** (a
single generation's fitness eval alone — running the flappy sim per genome — is
far over 1.4M CU). Arbitrum/Optimism solved the analogous problem by building an
*on-chain one-step interpreter* (WAVM / MIPS-Cannon) and bisecting all the way
down to a single machine instruction. That is a large subsystem. Options, honest:

- **Tier 1 — off-chain referee, on-chain transcript + public recheck (BUILD
  THIS FIRST, CWF-scale).** The coordinator executes the one disputed bucket
  off-chain and posts `(S_i, S_{i+1}, digest)` on-chain to resolve the Dispute.
  Because `S_i` is pinned and `advance_bucket` is deterministic and public,
  **any observer can re-run that single bucket and verify the verdict** — a
  dishonest referee is caught by anyone with the WASM module. Trust is reduced
  from "coordinator's word on the whole chunk" to "coordinator's word on one
  publicly-recomputable bucket, with the losing bond as a fraud bond." Bonds,
  intervals, timeouts, and the final `(S_i,S_{i+1})` all live on-chain. This is
  a genuine, large improvement over the status quo and is buildable in the CWF
  window.
- **Tier 2 — on-chain step executor (POST-CWF endgame).** Compile a
  CU-bounded step from the *same source* as the WASM module (zero-drift) and run
  it in a Solana program, so resolution is fully trustless. Requires designing
  the module ABI so one step fits Solana CU — almost certainly **finer than a
  bucket** (sub-generation, or a WASM-instruction interpreter à la Cannon), plus
  an extra bisection layer bucket→generation→instruction. Big build; the correct
  north star.
- **Tier 3 — zk one-step.** SNARK only the single disputed bucket (not the whole
  chunk) — prover cost bounded to one bucket, verified on-chain. A clean hybrid
  worth revisiting when zkVM tooling for our module is cheap. Best-of-both, but
  gated on tooling maturity.

Recommendation: ship **Tier 1** (trust-minimized, public-recheck fraud proof),
architect the Dispute state machine so Tier 2/3 can slot in as a different
resolver without changing the assert/challenge/bisect layers.

---

## 8. Economics & parameters

- `ASSERTER_BOND` / `CHALLENGER_BOND`: both must exceed the cost of a full
  chunk re-execution so a dispute is never grief-profitable in either
  direction; the honest party is made whole from the loser's bond, remainder
  burned (no coordinator profit — same principle as slash).
- `CHALLENGE_WINDOW`: tension between finality latency and watcher opportunity.
  Start ~small (minutes) with coordinator-as-challenger; lengthen when opening
  challenging to third parties. Per-lineage, config on the bounty.
- `STEP_TIMEOUT`: per bisection move; missing it = default loss.
- A **frivolous-challenge** guard: challenger loses their bond if the asserter
  is proven correct — symmetric with a fraudulent asserter losing theirs.
- Worker (asserter) bond here composes with the existing global stake/unstake-
  lock: an open dispute is "outstanding work," so the unstake-lock already
  refuses withdrawal mid-dispute (reuse the §D1 gate).

---

## 9. On-chain additions (program upgrade)

New accounts:
- `Lineage` PDA `["lin", job_id, idx]` → `{ confirmed_state_digest,
  generations_confirmed, bump }` (origin anchor).
- `Assertion` PDA `["assert", chunk_id]` → `{ asserter, merkle_root, d_s0,
  d_s256, n, bond, opened_slot, status }`.
- `Dispute` PDA `["dispute", chunk_id, challenger]` → `{ challenger, lo, hi,
  turn, deadline_slot, mid_digest, bond, status }`.

New instructions (all coordinator-aware where settlement touches money; mirror
the existing co-sign pattern): `assert_chunk`, `open_dispute`, `bisect`
(alternating), `resolve_one_step` (Tier-1: coordinator posts `(S_i,S_{i+1})`;
program checks digests + slashes loser), `timeout_resolve`, `confirm_chunk`
(window elapsed → write `Lineage.confirmed_state_digest`, release payment).
Reuse `slash` (burn) for a proven-cheat asserter's global bond.

Zero-drift note: the digest + Merkle rules encoded on-chain must be byte-exact
with `@sieveworks/{merkle,wasm-runtime}` and the coordinator — same discipline
as today's claim/close co-sign.

---

## 10. Coordinator & client changes

- Coordinator: run the reference re-execution to DECIDE whether to open a
  dispute (this is the "challenger" role; the compute is the same as today's
  audit, only now it produces an on-chain proof instead of a DB verdict). Serve
  bisection queries' expected digests; act as referee in Tier 1. Gate
  `confirm_chunk`/payment on window + no live dispute.
- Worker client (browser/CLI/desktop): retain `S_0…S_256`; respond to bisection
  challenges with Merkle openings; auto-forfeit on timeout. Purely additive to
  the existing training loop.

---

## 11. Attacks & failure modes (checklist for the build)

- **Lazy/absent challenger** → fraud finalizes. Mitigation: coordinator is
  always-on default challenger; third-party challenging + rewards later.
- **Grief by frivolous dispute** → symmetric bond slash of the challenger.
- **Data withholding** by asserter → step timeout, default loss.
- **Dishonest Tier-1 referee** → public recheck of the one posted bucket;
  reputational + (future) a meta-dispute over the referee's step. Tier 2/3
  removes this entirely.
- **Origin forgery** → blocked by the on-chain `digest(S_0)` == anchored
  `confirmed_state_digest` check.
- **Non-determinism drift** (module rebuild changes results) → the whole system
  assumes bit-exact `advance_bucket`; pin the worker_spec_hash per job (already
  done) and forbid mid-job module changes.
- **Bond math wrong** (dispute cheaper than the fraud it protects) → set bonds
  from measured full-chunk re-exec cost; re-check when chunk sizing changes.

---

## 12. Build breakdown (Tier 1)

1. Redefine the training leaf to the transition form (§4) + update
   commit/verify in `@sieveworks/wasm-runtime` + coordinator + worker clients.
   Regression: existing training E2E still passes with the new leaf.
2. `Lineage` PDA + origin-anchor check; migrate `latest_state` writes behind
   `confirm_chunk`.
3. `Assertion`/`Dispute` PDAs + `assert/open_dispute/bisect/resolve_one_step/
   timeout_resolve/confirm_chunk` instructions; hand-encoded builders in
   `packages/chain`.
4. Coordinator: challenger + referee + window/finality gating; wire the
   unstake-lock to treat open disputes as outstanding work.
5. Worker clients: trace retention + bisection responder.
6. Devnet E2E: honest chunk confirms after window; fabricated chunk → coordinator
   opens dispute → bisection localizes the bad bucket → one-step resolve slashes
   the asserter, rejects the chunk, `latest_state` never poisoned. Grief case:
   frivolous challenger loses bond.
7. Copy/docs: training now carries interactive-fraud-proof verification (Tier 1,
   public-recheck); state the honest-challenger + window assumptions plainly.

Each step is independently shippable; 1–2 land the origin-anchor win even before
the full game exists.

---

## 13. Open questions for the owner

- `CHALLENGE_WINDOW` length vs demo latency — how live must training finality
  feel on stage?
- Open third-party challenging for CWF, or coordinator-only challenger v1
  (simpler, still trust-reducing via public recheck)?
- Bond sizing denomination (SOL vs the bounty's price unit) and who funds the
  challenger bond when the coordinator is the challenger.
- Is window-gated finality (§6 v1) acceptable for the demo, or is optimistic
  chaining needed to show throughput?
