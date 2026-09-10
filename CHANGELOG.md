# Changelog

All Crypto World's Fair work (Sep 14 – Oct 12, 2026) is logged here, newest
first.

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
