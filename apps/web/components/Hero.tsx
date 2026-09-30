import Link from "next/link";
import { Magnetic } from "@/components/Magnetic";
import { HeroFlow } from "@/components/HeroFlow";

/**
 * Homepage hero. A plain statement of what Sieveworks is + the whole mechanism
 * in three illustrated steps (HeroFlow), so a first-time visitor gets it at a
 * glance — no scroll-jack, no WebGL. Padding-sized (not 100vh) so the next
 * section peeks and the scroll cue is honest. Entrance is the CSS-only .reveal
 * choreography (paints even before hydration; off under reduced-motion).
 */
export function Hero() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 sm:px-7 pt-14 sm:pt-20 pb-6">
      <div className="max-w-[60ch]">
        <h1 className="reveal font-display font-extrabold leading-[1.03] tracking-[-0.035em] text-[clamp(38px,7vw,66px)]">
          Pay strangers to compute.
          <br />
          <span className="text-[var(--accent)]">Prove they did.</span>
        </h1>
        <p className="reveal mt-5 text-[17px] sm:text-[18px] leading-[1.5] text-[var(--text-dim)] max-w-[54ch]" style={{ animationDelay: "90ms" }}>
          Sieveworks is a marketplace for <span className="text-[var(--text)]">verifiable compute</span>. Rent idle
          computers to run a huge search — and <span className="text-[var(--text)]">know they didn&apos;t fake it</span>.
          Re-checking the work costs about <span className="num">1%</span>, not <span className="num">200%</span>.
        </p>
        <div className="reveal mt-7 flex gap-3 flex-wrap" style={{ animationDelay: "160ms" }}>
          <Magnetic>
            <Link href="/contribute" data-cursor className="sheen inline-block font-medium text-[14px] px-6 py-3 text-[var(--bg)]" style={{ background: "var(--accent)" }}>
              Start contributing
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/how-it-works" data-cursor className="inline-block font-medium text-[14px] px-6 py-3 border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)] transition-colors">
              How it works
            </Link>
          </Magnetic>
        </div>
      </div>

      <div className="mt-12 sm:mt-16">
        <HeroFlow />
      </div>

      <div className="reveal-fade mt-10 flex justify-center" style={{ animationDelay: "560ms" }}>
        <div className="scroll-cue flex flex-col items-center gap-1.5 text-[var(--text-faint)]">
          <span className="barlabel">Scroll to see it running</span>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M4 7 L9 12 L14 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </section>
  );
}
