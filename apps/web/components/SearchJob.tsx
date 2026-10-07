import { Reveal } from "@/components/Reveal";

/** Demystifies "compute" for a non-technical reader with three concrete examples. */

const EXAMPLES = [
  {
    t: "The perfect Minecraft world",
    d: "One in a billion seeds has exactly the landscape you want. A crowd checks them all.",
    art: (
      <svg viewBox="0 0 64 56" width="56" aria-hidden>
        <rect x="6" y="10" width="52" height="40" rx="6" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
        <g fill="var(--accent-2)"><rect x="12" y="16" width="9" height="9" /><rect x="24" y="16" width="9" height="9" /><rect x="36" y="16" width="9" height="9" fill="var(--verified)" /><rect x="12" y="28" width="9" height="9" /><rect x="24" y="28" width="9" height="9" /><rect x="36" y="28" width="9" height="9" /></g>
      </svg>
    ),
  },
  {
    t: "An AI that learns to play",
    d: "Train it by trying thousands of “brains” and keeping the ones that score best.",
    art: (
      <svg viewBox="0 0 64 56" width="56" aria-hidden>
        <path d="M8 44 C 20 44, 20 20, 32 20 S 44 12, 56 12" fill="none" stroke="var(--verified)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="8" cy="44" r="4" fill="var(--amber)" /><circle cx="32" cy="20" r="4" fill="var(--accent)" /><circle cx="56" cy="12" r="5" fill="var(--verified)" />
      </svg>
    ),
  },
  {
    t: "A rare result in science or crypto",
    d: "A needle in a haystack: one input, out of trillions, that fits.",
    art: (
      <svg viewBox="0 0 64 56" width="56" aria-hidden>
        <g stroke="var(--border-bright)" strokeWidth="2"><line x1="10" y1="14" x2="54" y2="14" /><line x1="10" y1="24" x2="54" y2="24" /><line x1="10" y1="34" x2="54" y2="34" /><line x1="10" y1="44" x2="54" y2="44" /></g>
        <circle cx="40" cy="34" r="7" fill="none" stroke="var(--accent)" strokeWidth="2.5" /><line x1="45" y1="39" x2="52" y2="46" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function SearchJob() {
  return (
    <section className="py-20 sm:py-24 border-t border-[var(--border)]">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-7">
        <Reveal variant="up">
          <h2 className="font-display font-bold text-[clamp(27px,3.8vw,40px)] tracking-[-0.025em]">What&apos;s a &ldquo;search job&rdquo;?</h2>
          <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[62ch]">
            Some problems only have one way to solve them: try an enormous number of possibilities and keep the best. That&apos;s work a single computer would grind on for weeks. Split across a crowd, it finishes fast.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-3">
          {EXAMPLES.map((e, i) => (
            <Reveal key={e.t} variant="up" delay={i * 80}>
              {e.art}
              <div className="mt-3 font-display font-bold text-[16px]">{e.t}</div>
              <div className="mt-1 text-[13.5px] leading-[1.5] text-[var(--text-dim)] max-w-[34ch]">{e.d}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
