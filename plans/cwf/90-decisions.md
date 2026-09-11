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

---

## Audit findings → OWNER DECISIONS (roast-sieveworks run, Sep 11 2026)

Ran the critique skill against HEAD. It found a **real critical hole in the
stake code shipped Sep 10**. I applied the safe, unambiguous fixes overnight
and DEPLOYED the coordinator (see "Done overnight" below). These four are
genuine tradeoffs I did NOT touch — they need your call:

### D1 — The critical: on-chain `unstake`-lock (program redeploy)
`unstake` is a direct on-chain call with no coordinator gate, so a worker can
lease → unstake → submit fraud and a caught cheat burns 0. I shipped the
coordinator **stopgap** (re-check bond at submit time — forces staying bonded
through submission). Residual hole: worker can still unstake in the window
between submit and challenge resolution. **Real fix** = gate `unstake` behind a
coordinator co-signature (mirror `close_job`/`slash`) and refuse to co-sign
while the worker holds a live lease/open challenge. Cost: ~half-day + a program
redeploy (needs devnet SOL + your OK, since program upgrades are the one
irreversible-ish step). **Decision: do the on-chain lock, or is the stopgap +
short challenge window good enough for the demo?**

### D2 — Stake multiplier vs break-even (one constant, but it's a real tradeoff)
`requiredStake = max(price×15, 0.02 SOL)`. At a 5% audit rate the per-chunk
break-even multiplier is **19×**, so 15× leaves a small positive EV to a
fabricator (before honeypots/challenge, which constrain WHICH cheats are
feasible). Options: (a) raise multiplier to ≥19×, (b) raise audit rate from 5%,
(c) lean on the 0.02 floor (it dominates for cheap chunks anyway) and soften the
copy. You wanted MINIMUM friction — raising the multiplier or audit rate both
add cost. **Decision: which lever?** (My lean: bump floor-relative is fine;
raise audit rate to ~8-10% for extremum to match modes 2/3, cheaper than more
friction. But it's your economics call.)

### D3 — "Negative expected value" copy (honesty rail)
`how-it-works` + `StakePanel` state burn-on-slash as an *active* deterrent;
README still says it's "being wired … until then the deterrent is audit
exposure." Now that enforcement landed, these disagree. **Decision: (a) update
README to say enforcement is live (and I fix D1/D2 so the strong claim is
TRUE), or (b) soften the site copy to the README's hedge.** I did NOT edit the
copy — this is the pitch-honesty boundary and your call which direction.

### D4 — Two "known-gap" design items (defer vs fix)
- **Training origin poisoning**: an unaudited fabricated training chunk becomes
  the stored `latest_state` origin for the next honest worker (90% skip the
  audit lottery). Fix = force a transition challenge / coordinator recompute
  before writing `latest_state`. ~half-day.
- **Unclaimed-earnings escrow lock**: a worker who earns 1 lamport and never
  claims blocks the funder's `close_job` reclaim forever. Fix = grace-window
  reclaim of all-but-outstanding. ~2h.
**Decision: fix in-month, or document as known limits for the demo?**

### Done overnight (safe, deployed — no decision needed)
- Coordinator: submit-time bond re-check (D1 stopgap); lease gate now requires
  stake `state == Active` (was amount-only — a slashed-but-overfunded worker
  kept leasing); candidate rate-limit keyed on IP only (was IP+wallet →
  sybil-bypassable free scoring oracle). **Deployed to Fly.**
- On-chain `slash` docstring corrected (said "returned to buyer's pool"; code
  burns to incinerator). Comment-only, no redeploy.
- Full ranked report saved; the two Unverified items (viz WebRTC under CSP;
  "0.45% overhead" being extremum-best-case) are worth a look but unproven.

---

## EXECUTED (Sep 11, owner ratified D1–D4)

Owner picked: D1 on-chain unstake-lock, D2 audit rate→10%, D3 README-matches-site, D4 fix training poisoning.

- **D1 DONE + verified on devnet.** Program upgraded (tx 4GqQbaFR…) — `unstake` now
  requires the coordinator (const `COORDINATOR_AUTHORITY = 5FBPoodn…`) as a co-signer
  (address-bound; global bond has no escrow to carry it). Coordinator `/v1/unstake`
  co-signs only when no chunk is `leased`/`submitted` for the worker. Web StakePanel
  switched to partial-sign→co-sign. PROVEN: (a) gate returns 409 "work outstanding"
  with a lease held; (b) old worker-only unstake rejected on-chain — AnchorError
  AccountNotSigner (3010). Not independently executed: a full valid co-signed
  withdrawal landing (couldn't clear the deployer's live lease without churn) — but
  mechanics are byte-identical to the proven claim co-sign, and the negative test
  shows the program validates the coordinator account. Cooldown kept as backstop.
- **D2 DONE.** `AUDIT_RATE_PCT` 5→10 (deployed). Break-even multiplier now 9× (< 15×
  floor). how-it-works "0.45% @ 5%" → "0.9% @ 10%".
- **D3 DONE.** README "Stake and slash" rewritten: enforcement is live (bond + submit
  re-check + unstake-lock + burn), 10% audit → below-zero EV, honest residuals named.
- **D4 — NOT a clean half-day fix; needs an owner economics call.** Root issue:
  verifying sequential GA state cheaply is the hard part. Options: (a) full-replay
  every training chunk from stored origin before writing `latest_state` = provably
  no poisoning but ~100% verify overhead (kills the "cheap verification" story for
  training); (b) keep probabilistic 10% + slow-lane retroactive flag (current,
  documented honestly — poisoning detected after the fact, not prevented); (c) build
  a fraud-proof bisection game (correct AND cheap, but a real feature, not a patch);
  (d) offer (a) as a paid "high-assurance" flag, default (b). RECOMMEND (d) or (b)+
  honest copy. Deferred to owner — did NOT ship a subtly-wrong "fix".
- **Unclaimed-earnings escrow lock**: documented as known limit (pull-based payout;
  owner confirmed money isn't auto-pushed). Grace-window reclaim available on request.

**D4 RATIFIED (owner, Sep 11): option (c) — fraud-proof bisection.** Rationale: for a
compute *marketplace*, prover cost is the binding constraint — a zkVM would tax every
worker 10^3–10^6× (self-defeating), while bisection asks the worker for ~nothing beyond
the commitment and lets the referee settle any dispute by re-running ONE generation.
Precedent: TrueBit, Arbitrum. Accepted caveats: honest-challenger liveness (coordinator
= default challenger; game resolves objectively so 1 honest challenger beats a lying
majority → strictly LESS trust than today), a challenge window (escrow until it passes),
canonical bit-exact single-generation transition (already have via deterministic WASM),
data availability, game-correctness attack surface. NOT the abstract-best (zk wins on
unconditional non-interactive soundness) but the right fit here. INTERIM until built:
option (b) probabilistic 10% + slow-lane, with honest "fraud proofs are roadmap" copy.
Build = spec first (state-commitment format, bisection protocol, one-step proof,
on-chain referee, escrow/window), owner review, then implement w/ teach-along. Week 3-4+.
