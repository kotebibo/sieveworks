# Brand & Design Direction Brief — Sieveworks

*(Paste this whole thing to Claude Desktop. Ask it to produce a rendered HTML
mockup artifact of the landing hero so you can see it, iterate until you like
it, then give back the final spec.)*

---

You are a senior brand and product designer. Design a **complete visual identity
and design direction** for a product called **Sieveworks**, then render a
**single self-contained HTML artifact** showing the landing-page hero and one
"how it works" section so I can see and iterate on it.

## What Sieveworks is
An **exchange for verifiable search**. Someone funds a brute-force search job with
a budget. Contributors run chunks of the search space on their own hardware — in
the browser via WebAssembly or a native CLI — and get paid per **verified** chunk
on Solana. Every discovery is permanently attributed on-chain to whoever found it.
The launch use case is Minecraft seedfinding, but the platform is game-agnostic.

The defensible idea: most distributed-compute markets can't tell real work from
faked work without paying 2–3× for redundant execution. Sieveworks reframes every
task as "find the highest-scoring input in this range, and prove it with a
witness" — so verification costs under 1% instead of 200%. It's **hard to find,
easy to check.**

## Who it's for
- Solana / crypto-native developers and hackathon judges (credibility, technical depth matter)
- Minecraft seedfinders and similar technical hobbyist communities (real, not corporate)
- Buyers who want a specific search run and paid for honestly

## The feeling to hit
Trustworthy, precise, alive (real-time), technically serious — **credible, not
flashy**. It should feel like infrastructure a skeptical engineer would trust with
money, and like something alive with live data. Confidence without hype.

## The tension you must resolve
This is BOTH:
1. a **marketing site** that must explain and sell to a first-time visitor, and
2. a **live data product** (dashboards, a real-time "swarm" of work units, tables
   of scores/seeds/hashes).
One design system must serve both — marketing rhythm on the landing, calm density
in the app.

## A signature asset you can use (optional but encouraged)
The product's natural hero visual is a **live "swarm" grid**: one cell per unit of
the search space, cells lighting up as they get verified — the search space
visibly filling in. Consider making this the memorable centerpiece. The name
"Sieveworks" evokes a **sieve** (filtering, straining, catching the rare find).

## Hard NOs (avoid generic AI/crypto slop)
- No purple gradients, no glassmorphism, no neon-on-black "web3" cliché
- No stock-startup template look, no hero with a laptop mockup
- No walls of text, no vast empty whitespace with a tiny centered headline
- Not Inter, not Space Grotesk, not Roboto/Arial as the display face

## Deliverables (please provide ALL, then the mockup)
1. **Direction name + 2–3 sentence manifesto** — the point of view.
2. **Color palette, full light AND dark mode**, as hex with roles:
   background, surface/panel, elevated surface, primary text, muted text, faint
   text, border, ONE accent color, plus reserved semantic `verified` (green) and
   `rejected` (red). Give me these as CSS custom properties for `:root`/`.dark`
   and `.light`.
3. **Typography** — a distinctive display/heading font, a clean body font, and a
   monospace for data/numbers. **Use real Google Fonts and name them exactly** (I
   have to implement these). Give sizes/weights for h1/h2/body/mono.
4. **Logo / wordmark concept** for "Sieveworks" — describe it; simple enough to
   render in CSS/SVG.
5. **One signature visual motif** — the thing people remember.
6. **Tone of voice** — 3 adjectives, plus 3 do's and 3 don'ts, with one example
   headline rewrite of "An exchange for verifiable search."
7. **Landing page wireframe** — section by section (hero, the problem, how it
   works, live proof, for-contributors / for-funders, CTA, footer), noting what
   visual/data element anchors each section so it's never just text.
8. **Then render a single self-contained HTML artifact** of the hero + one
   section using the above, so I can see it. Iterate with me until I approve.

## Technical constraints for whatever you design (so it's implementable)
- It will be built in **Next.js + Tailwind v4**, fonts via `next/font/google`.
- Must ship **light and dark** mode with no flash and zero layout shift.
- Numbers everywhere are monospace + tabular. Motion is tasteful and mostly on
  real data change (a value updating, a cell verifying), not decorative scroll
  animations.
- Self-contained artifact: inline all CSS, embed any assets — no external calls.

When I approve the look, output the **final design spec** as: the CSS custom
properties (both themes), the exact Google Font names + weights, and the
section-by-section landing layout. I'll hand that to the engineer to build.
