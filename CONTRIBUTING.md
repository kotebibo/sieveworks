# Contributing to Sieveworks

Sieveworks is built in the open as a public good. The point isn't a walled
marketplace — it's the **mechanism**: a cheap, reproducible way to pay strangers
to run real compute and prove they actually ran it, without trusting them
(~1% verification overhead instead of ~200% redundant re-execution). It's most
useful if anyone can audit it, fork it, and build on it, so the protocol, the
verifier, and the worker all ship under the [MIT license](LICENSE).

## Ways to contribute

- **Run a worker.** Open [sievework.com/contribute](https://sievework.com/contribute)
  and a browser tab becomes a worker — no install. (Native CLI / desktop workers
  are in the repo.)
- **Write a module.** A module is a tiny deterministic scoring function compiled
  to WebAssembly: given one candidate, return its score. Anything shaped like
  "find the best across a huge space" works. See the module contract in
  [`/docs`](https://sievework.com/docs).
- **Audit the verification.** Every verified record exposes a public audit recipe
  (`GET /v1/audit/results/:id`) you can re-run against the pinned WASM artifact
  (`worker_spec_hash`). Finding a case the verifier misses is the most valuable
  contribution there is — please open an issue.
- **File issues and PRs** for bugs, docs, and new verticals.

## Local setup

```bash
pnpm install
pnpm build                                  # turbo builds packages in dependency order
pnpm --filter @sieveworks/worker-core test  # native-vs-WASM determinism test
cd apps/web && pnpm dev                     # local web against the live coordinator
```

## Ground rules

- **Determinism is sacred.** Verification *is* re-execution, so worker and
  verifier must produce bit-identical results. Keep float determinism discipline
  (`-ffp-contract=off`) and run the determinism test before submitting module or
  core changes.
- **Be honest in copy.** No overclaiming. Devnet is devnet; "detected" is not
  "prevented." If a limit exists, say it.
- **Be kind.** Assume good faith; keep discussion technical and welcoming.

By contributing you agree your contributions are licensed under the MIT license.
