# Sieveworks

**Verifiable distributed search compute — live at [sievework.com](https://sievework.com).**

Fund a brute-force search job; contributors run chunks of the search space on their own hardware — in the browser via WebAssembly or through a native CLI — and get paid per verified chunk on Solana (devnet). Every discovery is permanently attributed on-chain to whoever found it. Verification is deterministic and publicly reproducible at **0.45% measured overhead**, versus the ~200% of replication-based approaches.

The class of problem served: **hard to find, easy to check** — compact inputs, deterministic evaluation, and a witness anyone can re-verify in microseconds. Launch vertical: Minecraft seedfinding (via [cubiomes](https://github.com/Cubitect/cubiomes), MIT). The platform itself is game-agnostic.

## How cheating is prevented without redundant execution

1. **Extremum reframing** — every chunk answers "what is the highest-scoring seed in this range?" with a witness seed. There is no fakeable "found nothing."
2. **Merkle commit-and-challenge** — workers commit to per-bucket results with a single root; the coordinator challenges random buckets and recomputes them.
3. **Honeypot seeds** — the coordinator secretly knows answers scattered across the space; under-reporting is detectable and undetectable-by-workers.
4. **Stake and slash** — the Anchor program ships stake/unstake/slash and the design prices cheating below zero expected value; coordinator-side enforcement (stake-gated leasing, on-chain slashing on rejection) is being wired during the Crypto World's Fair window — until then the deterrent is audit exposure and forfeited payment, and paid bounties are platform-funded. Stated here plainly because honest scope is part of the design.
5. **Deterministic re-verification** — every claimed record is fully recomputed before on-chain attribution.

The coordinator verifies with the **identical WASM artifact** workers run, pinned by content hash (`worker_spec_hash`), making worker/verifier drift impossible by construction.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js app — bounty board, live job detail, in-browser worker (Vercel) |
| `apps/coordinator` | Fastify service — leasing, verification, SSE, voucher signing (Fly.io) |
| `apps/cli` | Native CLI worker — lease → evaluate → merkle commit → sign → submit |
| `packages/protocol` | The public interface: message schemas, canonical JSON, wallet signatures |
| `packages/merkle` | Commitment tree shared verbatim by workers and the verifier |
| `packages/worker-core` | C wrapper over vendored cubiomes; builds to native binary and WASM |
| `packages/wasm-runtime` | Hash-verifying WASM loader used by browsers and the coordinator |
| `programs/sieveworks` | Anchor program: find attribution, escrow, stake, claim vouchers |
| `supabase/migrations` | Postgres schema with RLS (honeypots and rejection reasons are dark) |

## Development

```bash
pnpm install
pnpm build                                  # turbo builds packages in dependency order
pnpm --filter @sieveworks/worker-core test  # native-vs-WASM determinism test
cd apps/web && pnpm dev                     # local web against the live coordinator
```

## Built during the Crypto World's Fair (Sep 14 – Oct 12, 2026)

The platform above shipped solo in 7 days (Aug 24–31, tag [`pre-cwf`](../../releases/tag/pre-cwf) marks that baseline). Everything after the tag is Crypto World's Fair work — tracked in [CHANGELOG.md](CHANGELOG.md) and specced in [`plans/cwf/`](plans/cwf/):

- **Verification modes** — generalizing beyond extremum search: `output_hash` recompute-audit (rendering) and checkpointed-trajectory training verification (evolutionary compute)
- **Prize bounties** — winner-takes-prize for the best verified candidate; an "AI learns to play" demo where the training swarm is paid per generation
- **Desktop worker** — full multi-core Tauri app; the website becomes onboarding
- **GPU execution** — wgpu kernel for hash-grind, verified by the unchanged CPU reference

Originally built for the Solana hackathon, August 2026.
