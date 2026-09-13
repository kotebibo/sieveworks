import Link from "next/link";

/**
 * Static hero — the instant first paint before the 3D chunk loads, and the
 * permanent hero on mobile / reduced-motion. Deliberately dependency-light
 * (no three.js, no motion) so it renders with zero delay.
 */
export function HeroFallback() {
  return (
    <section className="mx-auto max-w-[1180px] px-5 sm:px-7 pt-16 pb-10">
      <h1 className="font-display font-extrabold leading-[1.06] tracking-[-0.035em] text-[clamp(40px,8vw,64px)]">
        Pay strangers<br />to compute.<br /><span className="font-medium text-[var(--accent)]">Prove they did.</span>
      </h1>
      <p className="mt-5 text-[17px] text-[var(--text-dim)] max-w-[52ch]">
        Fund a search; anyone runs a slice in a browser tab, paid per verified chunk. Re-checking the work costs about 0.9% — not the 200% of running it three times.
      </p>
      <div className="mt-7 flex gap-3 flex-wrap">
        <Link href="/contribute" className="sheen font-medium text-[14px] px-5 py-[11px] text-[var(--bg)]" style={{ background: "var(--accent)" }}>Start contributing</Link>
        <Link href="/how-it-works" className="font-medium text-[14px] px-5 py-[11px] border border-[var(--border-bright)] text-[var(--text)]">How it works</Link>
      </div>
    </section>
  );
}
