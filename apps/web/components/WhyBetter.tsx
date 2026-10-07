import { Reveal } from "@/components/Reveal";

/**
 * "Why not just rent a datacenter?" — the why-better, as a plain comparison a
 * layperson gets. The alternatives are muted; Sieveworks is the resolved winner.
 */

const OPTIONS = [
  {
    t: "Rent cloud / GPUs", tag: "DIY, costly", win: false,
    d: "You buy all the power yourself and run the code yourself. Expensive, and it doesn't tap a crowd.",
    art: (<svg viewBox="0 0 40 40" width="40" aria-hidden><rect x="7" y="8" width="26" height="24" rx="4" fill="none" stroke="var(--text-faint)" strokeWidth="2" /><line x1="13" y1="15" x2="27" y2="15" stroke="var(--text-faint)" strokeWidth="2" /><line x1="13" y1="21" x2="27" y2="21" stroke="var(--text-faint)" strokeWidth="2" /></svg>),
  },
  {
    t: "Free volunteers", tag: "free, unsteerable", win: false,
    d: "People donate compute for science, but you can't direct it, can't pay for priority, and there's no marketplace.",
    art: (<svg viewBox="0 0 40 40" width="40" aria-hidden><circle cx="14" cy="16" r="5" fill="none" stroke="var(--text-faint)" strokeWidth="2" /><circle cx="26" cy="16" r="5" fill="none" stroke="var(--text-faint)" strokeWidth="2" /><path d="M7 32 c0-6 5-9 7-9 M26 32 c0-6 5-9 7-9" fill="none" stroke="var(--text-faint)" strokeWidth="2" /></svg>),
  },
  {
    t: "Other compute networks", tag: "+200% tax", win: false,
    d: "They can't check the work, so to be safe you run everything 2 to 3 times.",
    art: (<svg viewBox="0 0 40 40" width="40" aria-hidden><rect x="8" y="10" width="16" height="12" rx="2" fill="none" stroke="var(--text-faint)" strokeWidth="2" /><rect x="14" y="18" width="16" height="12" rx="2" fill="none" stroke="var(--text-faint)" strokeWidth="2" /></svg>),
  },
];

export function WhyBetter() {
  return (
    <section className="py-20 sm:py-24 border-t border-[var(--border)]">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-7">
        <Reveal variant="up">
          <h2 className="font-display font-bold text-[clamp(27px,3.8vw,40px)] tracking-[-0.025em]">Why not just rent a datacenter?</h2>
          <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[60ch]">Because the hard part isn&apos;t power, it&apos;s trust. Here&apos;s how the usual options stack up.</p>
        </Reveal>

        <div className="mt-10 flex flex-col gap-3">
          {OPTIONS.map((o, i) => (
            <Reveal key={o.t} variant="up" delay={i * 70}>
              <div className="grid grid-cols-[40px_1fr_auto] items-center gap-4 sm:gap-5 rounded-[14px] border border-[var(--border)] px-4 sm:px-5 py-4">
                <div className="opacity-80">{o.art}</div>
                <div>
                  <div className="font-display font-bold text-[15.5px] text-[var(--text-faint)]">{o.t}</div>
                  <div className="mt-0.5 text-[13.5px] leading-[1.5] text-[var(--text-faint)] max-w-[62ch]">{o.d}</div>
                </div>
                <div className="num text-[13px] text-[var(--text-faint)] whitespace-nowrap">{o.tag}</div>
              </div>
            </Reveal>
          ))}
          {/* the winner */}
          <Reveal variant="up" delay={220}>
            <div className="grid grid-cols-[40px_1fr_auto] items-center gap-4 sm:gap-5 rounded-[14px] border border-[var(--accent)] bg-[var(--accent-ghost)] px-4 sm:px-5 py-4 shadow-[var(--shadow-soft)]">
              <svg viewBox="0 0 40 40" width="40" aria-hidden><circle cx="20" cy="20" r="16" fill="rgba(30,158,92,0.12)" stroke="var(--verified)" strokeWidth="2.5" /><path d="M12 20 l6 6 l11 -13" fill="none" stroke="var(--verified)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <div>
                <div className="font-display font-bold text-[15.5px]">Sieveworks</div>
                <div className="mt-0.5 text-[13.5px] leading-[1.5] text-[var(--text-dim)] max-w-[62ch]">
                  Pay a crowd and trust the result. Every answer is re-checked in about <span className="num">0.4ms</span>, so cheating never pays.
                </div>
              </div>
              <div className="num text-[13px] font-semibold whitespace-nowrap" style={{ color: "var(--verified)" }}>about 1%</div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
