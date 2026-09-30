import { Reveal } from "@/components/Reveal";

/**
 * The reframe: why a stranger's work can be trusted. An illustrated side-by-side
 * contrast (no boxes, split by a hairline) — the old yes/no question a lie can
 * fake, with redundant re-runs at 200%, versus the extremum question whose answer
 * carries a witness, verified for ~1%.
 */
export function Reframe() {
  return (
    <div>
      <Reveal variant="up">
        <h2 className="font-display font-bold text-[clamp(28px,4.2vw,46px)] leading-[1.04] tracking-[-0.03em] max-w-[20ch]">
          Pay a stranger to compute, and <em className="not-italic text-[var(--accent)]">know</em> they didn&apos;t lie.
        </h2>
      </Reveal>

      <div className="mt-14 grid gap-12 md:grid-cols-2">
        {/* old way */}
        <Reveal variant="left" className="md:pr-12">
          <div className="barlabel">The old way</div>
          <p className="mt-4 font-display font-bold text-[24px] tracking-[-0.02em] text-[var(--text-dim)]">
            <span style={{ textDecoration: "line-through", textDecorationColor: "var(--text-faint)" }}>&ldquo;Did you find it?&rdquo;</span>
          </p>
          <p className="mt-3 text-[15.5px] leading-[1.55] text-[var(--text-dim)] max-w-[40ch]">
            A yes/no answer is free to fake. So the buyer runs the same work 2&ndash;3 times and compares.
          </p>

          <svg viewBox="0 0 240 92" width="240" className="mt-6 max-w-full" aria-hidden style={{ display: "block" }}>
            <rect x="46" y="14" width="118" height="46" rx="9" fill="var(--panel)" stroke="var(--border-bright)" strokeWidth="2" opacity="0.55" />
            <rect x="34" y="24" width="118" height="46" rx="9" fill="var(--panel)" stroke="var(--border-bright)" strokeWidth="2" opacity="0.8" />
            <rect x="22" y="34" width="118" height="46" rx="9" fill="var(--panel)" stroke="var(--text-faint)" strokeWidth="2" />
            <line x1="36" y1="50" x2="112" y2="50" stroke="var(--border-bright)" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="36" y1="64" x2="88" y2="64" stroke="var(--border-bright)" strokeWidth="3.5" strokeLinecap="round" />
            <text x="178" y="62" fontSize="20" fontWeight="700" fill="var(--text-faint)" style={{ fontFamily: "var(--font-mono), monospace" }}>&#215;3</text>
          </svg>

          <div className="mt-6 flex items-baseline gap-2.5">
            <span className="num font-display font-bold text-[38px] tracking-[-0.03em] text-[var(--text-dim)]">200%+</span>
            <span className="text-[13px] text-[var(--text-faint)]">just to not get cheated</span>
          </div>
        </Reveal>

        {/* the sieveworks way */}
        <Reveal variant="right" delay={90} className="md:border-l md:border-[var(--border)] md:pl-12">
          <div className="barlabel" style={{ color: "var(--accent)" }}>The Sieveworks way</div>
          <p className="mt-4 font-display font-bold text-[24px] tracking-[-0.02em]" style={{ color: "var(--accent)" }}>
            &ldquo;What&apos;s the best in this slice?&rdquo;
          </p>
          <p className="mt-3 text-[15.5px] leading-[1.55] text-[var(--text-dim)] max-w-[40ch]">
            Every answer carries a <span className="font-semibold text-[var(--text)]">witness</span>: one seed that must reproduce the score. A recheck kills a lie in microseconds.
          </p>

          <svg viewBox="0 0 240 92" width="240" className="mt-6 max-w-full" aria-hidden style={{ display: "block" }}>
            <rect x="22" y="26" width="118" height="46" rx="9" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
            <line x1="36" y1="42" x2="112" y2="42" stroke="var(--border-bright)" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="41" cy="58" r="5" fill="var(--accent)" />
            <text x="54" y="62" fontSize="12" fill="var(--text-faint)" style={{ fontFamily: "var(--font-mono), monospace" }}>witness seed</text>
            <path d="M150 49 h30" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M174 43 l7 6 l-7 6" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="206" cy="49" r="16" fill="rgba(30,158,92,0.12)" stroke="var(--verified)" strokeWidth="2" />
            <path d="M198 49 l6 6 l10 -12" fill="none" stroke="var(--verified)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>

          <div className="mt-6 flex items-baseline gap-2.5">
            <span className="num font-display font-bold text-[38px] tracking-[-0.03em]" style={{ color: "var(--accent)" }}>~1%</span>
            <span className="text-[13px] text-[var(--text-faint)]">to prove it, not redo it</span>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
