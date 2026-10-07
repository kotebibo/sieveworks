import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { SolanaMark } from "@/components/SolanaMark";

/**
 * "One network, two sides" — the fix for "people didn't realize there are both
 * funders and contributors." A balanced split (funder | the network | contributor)
 * joined by a central node. No identical cards; each side is distinct.
 */
export function TwoSides() {
  return (
    <section className="py-20 sm:py-24 border-t border-[var(--border)]">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-7">
        <Reveal variant="up">
          <h2 className="font-display font-bold text-[clamp(27px,3.8vw,40px)] tracking-[-0.025em]">One network, two sides.</h2>
          <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[60ch]">
            Bring a job, or bring a computer. The same network connects them: people who need work done, and people whose machines do it for pay.
          </p>
        </Reveal>

        <div className="mt-12 grid items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
          {/* funder */}
          <Reveal variant="left" className="flex flex-col items-start text-left md:items-end md:text-right md:pr-8">
            <div className="text-[13px] font-semibold text-[var(--text-faint)]">Have a huge job?</div>
            <h3 className="mt-1 font-display font-bold text-[21px]">Post it, pay for results.</h3>
            <svg viewBox="0 0 180 90" width="180" className="my-4 max-w-full" aria-hidden>
              <rect x="60" y="12" width="92" height="66" rx="9" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
              <line x1="74" y1="30" x2="138" y2="30" stroke="var(--border-bright)" strokeWidth="3" strokeLinecap="round" />
              <line x1="74" y1="44" x2="120" y2="44" stroke="var(--border-bright)" strokeWidth="3" strokeLinecap="round" />
              <g transform="translate(96,56)"><circle r="12" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" /><path d="M-4 0 h8 M0 -4 v8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /></g>
            </svg>
            <p className="text-[14.5px] leading-[1.55] text-[var(--text-dim)] max-w-[42ch]">
              Post a search, set a budget, and a crowd runs it. You pay per result, and only for work that passes verification. No datacenter, no trust required.
            </p>
            <Link href="/bounties/new" className="mt-4 inline-block sheen font-medium text-[14px] px-5 py-2.5 text-[var(--bg)]" style={{ background: "var(--accent)" }}>Post a job</Link>
          </Reveal>

          {/* the network node */}
          <Reveal variant="fade" delay={120} className="hidden md:block">
            <svg viewBox="0 0 90 120" width="84" aria-hidden>
              <g stroke="var(--accent)" strokeWidth="1.6" opacity="0.4"><line x1="10" y1="60" x2="45" y2="30" /><line x1="10" y1="60" x2="45" y2="90" /><line x1="80" y1="60" x2="45" y2="30" /><line x1="80" y1="60" x2="45" y2="90" /></g>
              <circle cx="45" cy="60" r="11" fill="var(--accent)" />
              <circle cx="10" cy="60" r="6" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
              <circle cx="80" cy="60" r="6" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
              <circle cx="45" cy="30" r="6" fill="var(--verified)" />
              <circle cx="45" cy="90" r="6" fill="var(--amber)" />
            </svg>
          </Reveal>

          {/* contributor */}
          <Reveal variant="right" delay={90} className="flex flex-col items-start text-left md:pl-8">
            <div className="text-[13px] font-semibold text-[var(--text-faint)]">Have a computer?</div>
            <h3 className="mt-1 font-display font-bold text-[21px]">Open a tab, earn.</h3>
            <svg viewBox="0 0 180 90" width="180" className="my-4 max-w-full" aria-hidden>
              <rect x="28" y="16" width="86" height="56" rx="8" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
              <rect x="36" y="24" width="70" height="40" rx="3" fill="var(--accent-ghost)" />
              <rect x="58" y="72" width="26" height="6" rx="3" fill="var(--border-bright)" />
              <g transform="translate(132,34)"><circle r="14" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" /><SolanaMark id="ts-coin" w={16} /></g>
            </svg>
            <p className="text-[14.5px] leading-[1.55] text-[var(--text-dim)] max-w-[42ch]">
              Open a tab and it starts earning. Your machine runs real paid work in the background, paid per verified piece. No install, no signup.
            </p>
            <Link href="/contribute" className="mt-4 inline-block font-medium text-[14px] px-5 py-2.5 border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)] transition-colors">Earn with your computer</Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
