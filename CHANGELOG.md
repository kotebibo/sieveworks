# Changelog

All Crypto World's Fair work (Sep 14 – Oct 12, 2026) is logged here, newest
first.

## 2026-09-11 (night, later) — The prize money loop closes on devnet

The E2E prize bounty settled itself: the sweeper awarded the winner at the
deadline; the winner claimed 0.005 SOL from the escrow through the standard
co-signed voucher (tx p2wNUsrB…); the funder reclaimed the escrow remainder
through the UPGRADED close_job (tx 5APBRckw…) — which required the
coordinator's co-signature and correctly refused until the winner had been
paid. Fund → compete → verify → award → claim → reclaim, all real
transactions, no manual steps.

## 2026-09-11 (night) — Paid-per-generation training verified on prod

The third verification mode: workers are paid per chunk of TRAINING WORK
(8,192 generations of a deterministic in-module GA), verified without
redundancy via chain-of-checkpoint transition audits.

- The GA runs INSIDE the module with counter-chained randomness, so the
  honest chain is UNIQUE: origin forced by sha256(job‖lineage), every
  audited bucket recomputed server-side from the worker-provided (and
  commitment-anchored) start state.
- Island-model lineages ride the existing chunk machinery; each delivered
  final state rolls the successor chunk. Delivery gates payment.
- Proven on prod: honest forced-audit chunk (challenged incl. bucket 0)
  accepted+paid; a fabricated-tail cheat caught at the transition audit,
  rejected, unpaid. 7 chunks / 57k generations trained across 4 lineages.
- The month's one program change deployed: on-chain close_job now requires
  the coordinator's co-signature — a prize funder can no longer sweep the
  escrow mid-competition.

## 2026-09-11 (later) — Prize bounties + "AI learns to fly" live on prod

- **Prize bounties**: fund a winner-takes-all pot for the best verified
  CANDIDATE (a byte blob scored by the module in one deterministic call)
  above a threshold by a deadline. Open submissions — no chunks, no leases;
  every submission is re-verified immediately in a dedicated evaluation
  pool; scores are public, candidate bytes stay sealed until close.
  Settlement reuses the existing escrow + claim-voucher machinery
  unchanged. Each job carries a FORCED unique landscape salt, so winning
  genomes don't transfer between bounties.
- **"AI learns to fly" module**: 130-byte neural-net genomes fly a
  flappy-style course generated from the job salt. Integer-only physics.
  A miniature GA masters a course (40/40 pipes) in ~20 generations.
- **/train/[job]**: evolve in your browser, watch the best bird fly live,
  submit your champion, sealed leaderboard. **/bounties/new** grows a prize
  toggle (prize, threshold, deadline) with the same wallet-funding flow.
- Proven E2E on devnet prod with a real 0.005 SOL escrow: honest submission
  verified, inflated claim rejected, leaderboard sealed.

## 2026-09-11 — Verification generalizes: `output_hash` mode live on prod

Colosseum's registration page says "start building right away" — so we did.

- **Second verification mode** (`output_hash`): jobs can now verify
  deterministic OUTPUT production, not just extremum search. Same Merkle
  commit-and-challenge machinery — the 16-byte leaf payload is reinterpreted
  as an opaque digest of the bucket's bytes (job-salted, so outputs can't be
  resold across jobs). No witness/honeypots (no ordering exists); detection
  is sampled recomputation at a higher audit rate, and **delivery gates
  payment**: earnings are credited only after the delivered bytes rebuild
  the committed root.
- **Mandelbrot render module** (builtin #4): fixed-point integer fractal
  tiles, zero floats, WASM-only. `/render/[job]` watches the swarm assemble
  the image tile by verified tile.
- **Mode-2 CLI worker** (`apps/cli/src/render.ts`) with adversarial cheat
  modes. Proven E2E on prod: honest → challenged → delivered → paid;
  fabricated commitments and corrupted deliveries both caught and unpaid.
- **Protocol**: optional `mode` field designed so every pre-mode worker
  signature still verifies (tested both shapes, proven live).
- **Hardening** (from the pre-window adversarial review): the mandatory
  first-3 audit window now counts only PASSED results — three sacrificial
  failures no longer age a wallet out of 100% auditing. The `pre-cwf` git tag marks the pre-competition baseline: the full
platform as shipped solo Aug 24–31 (verification pipeline, module registry,
browser + CLI workers, on-chain escrow/attestation/claims on devnet) plus
the Sep 1–10 polish window (sievework.com, docs site, pitch assets).

## [pre-cwf baseline] — 2026-09-11

- Judge-first README pass: live link, honest stake/slash status, CWF section.
- Implementation specs for the five CWF build fronts in `plans/cwf/`
  (3-agent codebase exploration + 2-agent adversarial review, findings
  folded in).
