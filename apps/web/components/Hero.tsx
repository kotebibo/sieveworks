import Link from "next/link";
import { Magnetic } from "@/components/Magnetic";
import { BackgroundGlobe } from "@/components/BackgroundGlobe";

/**
 * Homepage hero — the two sides of the marketplace, front and center, over a
 * subtle 3D globe backdrop. A non-technical visitor sees immediately that they
 * can bring a job or bring a computer. CSS-only .reveal entrance.
 */
function JobIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <rect x="8" y="7" width="32" height="26" rx="6" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
      <line x1="15" y1="16" x2="33" y2="16" stroke="var(--border-bright)" strokeWidth="3" strokeLinecap="round" />
      <line x1="15" y1="23" x2="28" y2="23" stroke="var(--border-bright)" strokeWidth="3" strokeLinecap="round" />
      <g transform="translate(24,37)"><circle r="9" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" /><path d="M-3.5 0h7M0 -3.5v7" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /></g>
    </svg>
  );
}

function ComputerIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <rect x="7" y="9" width="34" height="24" rx="6" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
      <rect x="12" y="14" width="24" height="14" rx="2" fill="var(--accent-ghost)" />
      <rect x="19" y="37" width="10" height="4" rx="2" fill="var(--border-bright)" />
      <line x1="16" y1="41" x2="32" y2="41" stroke="var(--border-bright)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden min-h-screen flex items-center">
      {/* 3D dotted-globe backdrop, sized to the full-height hero */}
      <div className="pointer-events-none absolute top-1/2 right-[-10%] -translate-y-1/2 h-[92vh] max-h-[840px] aspect-square opacity-60 hidden md:block" aria-hidden>
        <BackgroundGlobe />
      </div>

      <div className="relative z-10 w-full mx-auto max-w-[1120px] px-5 sm:px-7 py-20">
        <h1 className="reveal font-display font-extrabold leading-[1.04] tracking-[-0.03em] text-[clamp(32px,5vw,56px)] max-w-[15ch]">
          Two ways into one network.
        </h1>
        <p className="reveal mt-5 text-[17px] sm:text-[18px] leading-[1.5] text-[var(--text-dim)] max-w-[52ch]" style={{ animationDelay: "90ms" }}>
          A crowd of everyday computers runs huge jobs, and every result is proven real. Bring a job, or bring a computer.
        </p>

        <div className="reveal mt-10 grid gap-5 md:grid-cols-2 max-w-[880px]" style={{ animationDelay: "160ms" }}>
          <div className="panel p-6 sm:p-7">
            <div className="flex items-center gap-3.5">
              <JobIcon />
              <div>
                <div className="font-display font-bold text-[18px]">Have a huge job?</div>
                <div className="text-[13px] text-[var(--text-faint)]">Post it, pay for verified results.</div>
              </div>
            </div>
            <p className="mt-3.5 text-[14.5px] leading-[1.55] text-[var(--text-dim)]">
              Set a budget, a crowd runs it, and you pay only for work that passes verification. No datacenter, no trust required.
            </p>
            <Magnetic>
              <Link href="/bounties/new" data-cursor className="sheen mt-4 inline-block font-medium text-[14px] px-5 py-2.5 text-[var(--bg)]" style={{ background: "var(--accent)" }}>Post a job</Link>
            </Magnetic>
          </div>

          <div className="panel p-6 sm:p-7">
            <div className="flex items-center gap-3.5">
              <ComputerIcon />
              <div>
                <div className="font-display font-bold text-[18px]">Have a computer?</div>
                <div className="text-[13px] text-[var(--text-faint)]">Open a tab, earn.</div>
              </div>
            </div>
            <p className="mt-3.5 text-[14.5px] leading-[1.55] text-[var(--text-dim)]">
              Open a tab and it starts earning. Your machine runs real paid work in the background, paid per verified piece. No install, no signup.
            </p>
            <Magnetic>
              <Link href="/contribute" data-cursor className="mt-4 inline-block font-medium text-[14px] px-5 py-2.5 border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)] transition-colors">Earn with your computer</Link>
            </Magnetic>
          </div>
        </div>
      </div>
    </section>
  );
}
