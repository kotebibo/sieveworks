# Spec 04 — Desktop worker app v1 (Tauri)

**Week 3.** The compute story escapes the browser tab: an installable
worker with full multi-core CPU, tray presence, and the website as the
onboarding funnel. FRAMING RULE (assessment §1b): "more verified compute
per worker," never "earn passive income with idle hardware."

## 1. Architecture decision (explorer-grounded)

**v1 = Tauri shell around the existing worker web bundle.** The exploration
confirmed: `protocol`, `merkle`, `wasm-runtime` have zero browser-specific
APIs (the coordinator already runs them under Node); the ONLY
browser-coupled file is `engine.ts` (localStorage, Worker,
crypto.getRandomValues — all present in Tauri's webview) and Web Workers in
WebView2/WebKit are real OS threads. The CLI already proves a second client
speaking the full protocol with zero coordinator changes; CORS is
`origin: true`; compute endpoints need no SIWS (body wallet + ed25519
result signature only).

A pure-Rust native backend (spawning the native module processes CLI-style)
is the v2 optimization — bounded, mechanical (~160 lines of
canonical-JSON + merkle + signing to port) but NOT needed for the demo win.

## 2. App shape

```
apps/desktop/            # Tauri 2.x
  src-tauri/             # Rust shell: window, tray, autostart, single-instance
  src/                   # Svelte-or-React minimal UI (reuse packages/ui tokens)
```
- UI = a focused worker console: job picker (fetch open jobs), thread count
  slider (default = ALL cores — `hardwareConcurrency`, cap removed: the
  browser's `-1` was a UI policy, one line), live seeds/sec + earnings,
  start/stop, payout-address field (paste a wallet address — no wallet
  adapter needed for contributing; claiming happens on the website).
- Engine: extract `apps/web/lib/worker/{engine,evaluator.worker}.ts` into
  `packages/worker-engine` consumed by BOTH apps/web and apps/desktop
  (the refactor is the main real work — move, fix imports, keep
  localStorage abstraction behind a tiny `KV` interface: web = localStorage,
  desktop = Tauri store plugin so the worker key survives).
- Tray: start/stop, "open dashboard" (deep-link to sievework.com), quit.
  Run-on-idle and autostart = stretch toggles (cut list item 3).
- Auto-update: Tauri updater with GitHub Releases feed — REQUIRED for
  judging month hotfixes; set up day 1, not last.
- Distribution: Windows NSIS + macOS dmg (unsigned + notarization note —
  judges on macOS will see Gatekeeper; document the right-click-open
  bypass on the download page) + Linux AppImage. Windows is the demo priority.

## 3. Coordinator / infra deltas

- None protocol-wise (explorer-confirmed). Two ops items:
  - Rate limit: 1000 req/min per IP was tuned for one tab; a desktop app
    at full cores is fine (leases are seconds apart), but add a
    load-test check during W3 day 2.
  - `GET /v1/version/desktop` (static JSON: latest version + download URLs)
    for the website funnel + in-app update check fallback.
- Website funnel: `/download` page + a "go 10×: install the desktop worker"
  card on /contribute (positioning per plan §W3).

## 4. Mode coverage

The engine refactor carries ALL THREE verification modes (extremum,
output_hash, training) automatically — same code. The desktop demo beat:
training job at full cores, fitness curve climbing visibly faster than the
browser tab next to it.

## 5. Sequencing (4 days inside W3)

| Day | Deliverable |
|---|---|
| 1 | `packages/worker-engine` extraction; web still green (regression: browser contribute E2E on prod-like env); Tauri scaffold boots with the bundle; updater wired. |
| 2 | Desktop UI console; KV store; payout address; thread slider full-core; lease/submit/challenge E2E against prod from the app; rate-limit check. |
| 3 | Tray + packaging (NSIS/dmg/AppImage) + GitHub Releases pipeline (tag-triggered workflow); /download page. |
| 4 | Polish + the side-by-side demo clip (browser vs desktop seeds/sec) + docs. |

## 6. Risks

- **The engine extraction is the only risky refactor** — it touches the
  live browser worker. Do it first, behind a same-day prod regression.
- WebGPU availability inside WebView2 matters for Spec 05 — verify on day 1
  (flag: WebView2 supports WebGPU on recent Evergreen; if absent on the
  demo machine, Spec 05 falls back to native wgpu via a Tauri command,
  which is its own §4 fallback).
- Unsigned macOS builds scare judges — the download page must show the
  bypass honestly; Windows demo machine avoids the issue.
- New workspace package(s) → Dockerfile filter list check (worker-engine is
  web-side; coordinator untouched — verify no accidental import).

## 7. Decisions taken by default

- Tauri (not Electron): 10× smaller download, Rust shell aligns with the
  "lean solo builder" story; Web Workers are real threads either way.
- Webview engine reuse v1; native-Rust workers deferred.
- Contribution requires no wallet connect in-app (paste payout address);
  claiming stays on the website with the wallet adapter.
