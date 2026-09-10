# CWF Feature Plans — Overview

Implementation-ready specs for the five Crypto World's Fair build fronts
(Sep 14 – Oct 12, 2026). Strategy context lives in the Obsidian vault
(`60-execution/Colosseum CWF Plan.md`); these documents are the engineering
side: exact schema changes, module contracts, pipeline branches, and
day-level sequencing.

## The five features

| # | Spec | Week | Status |
|---|------|------|--------|
| 1 | [01-output-hash-mode.md](01-output-hash-mode.md) — `output_hash` verification mode + Mandelbrot render module | W1 d1–3 | planned |
| 2 | [02-prize-mode-evolutionary.md](02-prize-mode-evolutionary.md) — prize (result-bounty) mode + "AI learns" module | W1 d4–7 | planned |
| 3 | [03-effort-mode-ga.md](03-effort-mode-ga.md) — paid-per-generation training (checkpointed trajectories) | W2 | planned |
| 4 | [04-desktop-worker.md](04-desktop-worker.md) — Tauri desktop worker app v1 | W3 | planned |
| 5 | [05-gpu-hash-grind.md](05-gpu-hash-grind.md) — wgpu GPU kernel for hash-grind | W3 stretch | planned |

## Shared constraints (apply to every spec)

- The coordinator verifies with the identical WASM artifact workers run —
  no separate native verifier, ever (SPEC.md §3).
- u64s cross the wire as decimal strings; DB uses numeric(20,0).
- Migrations land before the code that uses them.
- New workspace packages must be added to apps/coordinator/Dockerfile's
  filter list (known deploy gotcha).
- Web deploys from repo root only.
- Every day ends deployed and working end to end.
- Honesty rails: capability claims only; no "on-chain verification" phrasing;
  never "earn passive income with idle hardware."

## Review provenance

Specs were grounded by a 3-agent codebase exploration, then hardened by a
2-agent review pass (2026-09-11): a reality check against the actual code
(9 findings — wire-encoding signedness, null crashes, schema conflicts,
claims-UI filter, RLS gap, rolling-chunk races) and an adversarial protocol
attack (10 findings — unguarded close_job, reputation-gate bypass,
payment-before-delivery, cross-job genome/digest reuse, lineage poisoning,
oracle DoS, frozen-params, audit-scaling, conformance envelope). ALL
findings are folded into the specs inline, marked "REVIEW-FIXED" /
"review fix". The stake-honesty verdict lives in spec 01 §9b and
90-decisions #8.

## Decisions resolved by default (owner can override)

Collected per-spec at the bottom of each document; the cross-cutting ones are
listed in [90-decisions.md](90-decisions.md).
