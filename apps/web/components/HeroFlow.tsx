import { Sieve } from "@/components/Sieve";

/**
 * The hero's centerpiece: the whole product in three illustrated steps —
 * Funded → Sieved → Verified & paid. Light SVG + one reused <Sieve>; no WebGL.
 * Cards fade up (CSS one-shot .reveal-panel so they paint even before JS), the
 * connectors draw in, and each art has one calm looping accent — all disabled
 * under prefers-reduced-motion (see globals.css).
 */

// A crafted 10-wide, part-verified grid so step 2 shows real texture:
// a = verified (green), v = record (sky), l = leased/searching, p = empty.
const SIEVE_CELLS =
  "aaaavaalpa" + "aavaaaaaal" + "aaaaaavaaa" + "laaaaaaaav" + "aaapaaaaaa";

function VaultArt() {
  return (
    <svg width="118" height="108" viewBox="0 0 118 108" fill="none" className="hero-float" role="presentation">
      <rect x="20" y="16" width="78" height="76" rx="13" fill="var(--panel-2)" stroke="var(--border-bright)" strokeWidth="2" />
      <circle cx="59" cy="54" r="19" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" />
      <text x="59" y="61" textAnchor="middle" fontSize="20" fill="var(--accent)" style={{ fontFamily: "var(--font-mono), monospace" }}>◎</text>
      {/* dial spokes */}
      <line x1="59" y1="30" x2="59" y2="36" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="59" y1="72" x2="59" y2="78" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="35" y1="54" x2="41" y2="54" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="77" y1="54" x2="83" y2="54" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      {/* little bolts */}
      <circle cx="29" cy="25" r="2" fill="var(--border-bright)" />
      <circle cx="89" cy="25" r="2" fill="var(--border-bright)" />
      <circle cx="29" cy="83" r="2" fill="var(--border-bright)" />
      <circle cx="89" cy="83" r="2" fill="var(--border-bright)" />
    </svg>
  );
}

function VerifyArt() {
  return (
    <svg width="118" height="108" viewBox="0 0 118 108" fill="none" role="presentation">
      <circle cx="52" cy="50" r="30" fill="color-mix(in srgb, var(--verified) 13%, transparent)" stroke="var(--verified)" strokeWidth="2" className="hero-pulse" />
      <path d="M39 51 l9 9 l17 -19" stroke="var(--verified)" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* paid chip */}
      <g transform="translate(74 62)">
        <circle cx="14" cy="14" r="14" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="1.5" />
        <text x="14" y="19" textAnchor="middle" fontSize="14" fill="var(--accent)" style={{ fontFamily: "var(--font-mono), monospace" }}>◎</text>
      </g>
    </svg>
  );
}

function ArrowConnector() {
  return (
    <div className="flex items-center justify-center shrink-0 text-[var(--accent)] rotate-90 md:rotate-0 py-1 md:py-0" aria-hidden>
      <svg width="34" height="16" viewBox="0 0 34 16" fill="none">
        <path d="M2 8 H25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flow-arrow-line" />
        <path d="M20 3 L26 8 L20 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" className="flow-arrow-head" />
      </svg>
    </div>
  );
}

function Card({ step, title, desc, delay, children }: { step: number; title: string; desc: string; delay: number; children: React.ReactNode }) {
  return (
    <div className="reveal-panel panel p-5 sm:p-6 flex-1 min-w-0 flex flex-col" style={{ animationDelay: `${delay}ms` }}>
      <div className="num text-[13px] text-[var(--text-faint)]">Step 0{step}</div>
      <div className="mt-3 h-[116px] flex items-center justify-center" aria-hidden>{children}</div>
      <div className="mt-2 font-display font-bold text-[17px] tracking-[-0.01em]">{title}</div>
      <p className="mt-1.5 text-[14px] leading-[1.5] text-[var(--text-dim)]">{desc}</p>
    </div>
  );
}

export function HeroFlow() {
  return (
    <div className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-2.5">
      <Card step={1} title="Funded" desc="A bounty locks its budget in an on-chain escrow before any work starts." delay={220}>
        <VaultArt />
      </Card>
      <ArrowConnector />
      <Card step={2} title="Sieved" desc="Strangers run slices in a browser tab. Every answer carries a witness — one seed that reproduces the score." delay={320}>
        <div className="sieve-sweep w-full max-w-[190px]">
          <Sieve cells={SIEVE_CELLS} cols={10} />
        </div>
      </Card>
      <ArrowConnector />
      <Card step={3} title="Verified & paid" desc="The witness re-checks in ~0.4ms. Cheats are rejected; honest workers get paid on Solana." delay={420}>
        <VerifyArt />
      </Card>
    </div>
  );
}
