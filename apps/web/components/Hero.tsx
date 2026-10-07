import Link from "next/link";
import { Magnetic } from "@/components/Magnetic";
import { HeroSwarm } from "@/components/HeroSwarm";

/**
 * Homepage hero. Leads with a plain benefit a non-technical person gets instantly,
 * and makes the marketplace's two sides visible up front via the two CTAs. The
 * swarm illustration shows a crowd crunching one job. CSS-only .reveal entrance.
 */
export function Hero() {
  return (
    <section className="mx-auto max-w-[1120px] px-5 sm:px-7 pt-14 sm:pt-20 pb-8">
      <h1 className="reveal font-display font-extrabold leading-[1.05] tracking-[-0.03em] text-[clamp(30px,4.6vw,52px)] max-w-[820px] text-balance">
        A supercomputer&apos;s worth of work, done by a crowd, for a fraction of the cost.
      </h1>
      <p className="reveal mt-6 text-[17px] sm:text-[18px] leading-[1.5] text-[var(--text-dim)] max-w-[56ch]" style={{ animationDelay: "90ms" }}>
        Sieveworks splits huge jobs across thousands of everyday computers. You pay only for work
        that&apos;s checked and proven real: about <span className="num">1%</span> overhead, not the <span className="num">200%</span> of running everything twice to be safe.
      </p>
      <div className="reveal mt-7 flex flex-wrap items-center gap-3" style={{ animationDelay: "160ms" }}>
        <Magnetic>
          <Link href="/bounties/new" data-cursor className="sheen inline-block font-medium text-[14.5px] px-6 py-3 text-[var(--bg)]" style={{ background: "var(--accent)" }}>
            Post a job
          </Link>
        </Magnetic>
        <Magnetic>
          <Link href="/contribute" data-cursor className="inline-block font-medium text-[14.5px] px-6 py-3 border border-[var(--border-bright)] text-[var(--text)] hover:border-[var(--text)] transition-colors">
            Earn with your computer
          </Link>
        </Magnetic>
        <span className="w-full text-[12.5px] text-[var(--text-faint)]">Two sides, one network: bring a job, or bring a computer.</span>
      </div>

      <div className="reveal-fade mt-12 sm:mt-14" style={{ animationDelay: "320ms" }}>
        <HeroSwarm />
      </div>
    </section>
  );
}
