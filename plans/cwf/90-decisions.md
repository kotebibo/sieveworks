# CWF Plans — Owner decisions

## RATIFIED 2026-09-11 (owner)

1. close_job program upgrade: **YES** (coordinator co-sign; W1 d5 / first
   W2 buffer; prize bounties own-funded until it lands).
2. Stake enforcement: **YES**, after the visible features — W2/W3 buffer,
   ranked ahead of GPU.
3. Evo demo: **flappy-bird-style side-scroller** (owner override — build
   it directly, skip the cart-pole intermediate; keep the physics integer
   fixed-point; the pipe-gap course is derived from the seeded PRNG so
   per-job salt changes the course).
4. Islands M: deferred — owner decides after seeing the first fitness
   chart (W2 day 1 benchmark demo); explain simply at that moment.
   Default 32 until then.
5. Desktop platforms: default (Win+mac+Linux; Windows-only fallback).
6. bounty_kind naming: ship 'coverage/prize/training' now. UI labels are
   changeable anytime; the internal API/DB strings are cheap to migrate
   THIS month and get expensive once external users/modules depend on
   them — revisit at freeze if wanted.

**Standing owner rule:** the month must be BOTH bulletproof and impressive.
If the schedule slips, the first response is MORE HOURS, not cutting — the
cut order below is the fallback only if the owner explicitly invokes it.
Claude: track pace against the weekly plan and REMIND the owner when
falling behind (part of every build-day summary).

## Original decision list (for context — see ratifications above)

1. **Evo demo sim: cart-pole vs flappy-style side-scroller** (Spec 02 §8).
   Default: build cart-pole first (simplest deterministic physics), swap
   the visual to a side-scroller only if the replay looks boring on canvas.
   You are the taste judge here — decide when you see the first replay clip
   (W1 day 6).
2. **Training-job knobs** (Spec 03 §5): G/B/population/steps get fixed by
   the W2 day-1 benchmark, not by taste. The one taste knob: lineages M
   (default 32) — bigger M = more parallel contributors visible, slower
   per-lineage progress. Decide after seeing the first curve.
3. **Desktop v1 platforms** (Spec 04): default Windows installer + macOS
   dmg (unsigned) + AppImage. If time pressure hits, Windows-only is
   acceptable for judging (your demo machine) — your call at W3.
4. **Spec 05 go/no-go** happens at end of W3 day 2 by the cut-order rule —
   automatic, but you can veto GPU work entirely to protect video time.
5. **Prize-mode tie-break & sniping posture** (Spec 02 §7): default =
   earliest submission wins ties; candidate bytes hidden until close;
   commit-reveal deferred. Sign off or tighten.
6. **jobs.bounty_kind naming** ('coverage'|'prize'|'training') appears in
   API and UI copy — bikeshed window closes when the W1 migration lands.
7. **The month's ONE program change — `close_job` co-sign gating (Spec 02).**
   The adversarial review proved the deployed instruction lets any funder
   sweep a prize escrow the moment a worker nears the threshold (exploit
   live on devnet today, UI or not). Default: YES, upgrade the program
   (~30 lines, coordinator co-sign like Slash), W1 day 5 or first W2
   buffer; prize bounties stay own-funded until it lands. Veto = prize
   mode ships own-funded-only all month with the caveat documented.
8. **Wire minimal stake enforcement in-month?** Review confirmed stake is
   fully dormant, which makes "cheating is negative EV" currently FALSE at
   any audit rate under 50% (and the first-3 audit gate was bypassable —
   that one-line fix ships W1 regardless). Default: docs/audit-endpoint
   say the honest thing from W1; actual stake wiring (stakeIx builder +
   lease gate + on-chain slash call, ~1 day) is a W2/W3 buffer item ranked
   AHEAD of GPU in value if traction brings external workers. Your call
   whether it outranks desktop polish too.

## Defaults already taken in the specs (skim)

- Verification-mode discriminator = optional WASM export
  `verification_mode()`; travels with the artifact (Spec 01).
- Merkle leaf 16-byte payload reinterpreted as opaque digest in modes
  2–3 — zero merkle code changes (Specs 01/03).
- Mode 2/3 audit rate 10% (separate env vars); bucket 0 always audited in
  mode 3 (origin anchor).
- On-chain: NO program changes all month. Prize award reuses claim();
  prize attestation reuses record_find with digest-as-seed; close_job
  gets wired (builder + funder-only UI button).
- Output delivery = post-accept upload, digest-checked per bucket, 10-min
  window, no slash on delivery timeout (Spec 01).
- GA runs inside the module for mode 3 (determinism), host-side only on
  the open-prize /train page (Spec 02).
- Tauri + webview engine reuse for desktop v1; native-Rust workers are v2.
- GPU path is hash-gated to the hashgrind builtin only; WASM stays the
  reference forever.
- Engine extraction to `packages/worker-engine` happens W3 day 1 with a
  same-day browser regression (the riskiest refactor of the month).
