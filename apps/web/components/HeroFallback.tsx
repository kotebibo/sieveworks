import Link from "next/link";

/**
 * Static hero — the instant first paint before the 3D chunk loads, and the
 * permanent hero on mobile / reduced-motion. Dependency-light (no three.js);
 * the sieve motif is pure CSS so it renders with zero delay and still gives
 * mobile some life.
 */

// x% across, animation delay, and behavior/color for each falling seed.
const DROPS: { x: number; d: number; k: "pass" | "green" | "amber" }[] = [
  { x: 8, d: 0, k: "pass" },
  { x: 22, d: 0.9, k: "green" },
  { x: 36, d: 1.8, k: "pass" },
  { x: 50, d: 0.4, k: "amber" },
  { x: 64, d: 1.3, k: "pass" },
  { x: 78, d: 2.1, k: "green" },
  { x: 91, d: 0.7, k: "pass" },
];
const DROP_COLOR = { pass: "var(--accent-2)", green: "var(--verified)", amber: "#E08A2B" };

export function HeroFallback() {
  return (
    <section className="mx-auto max-w-[1180px] px-5 sm:px-7 pt-16 pb-10">
      <h1 className="font-display font-extrabold leading-[1.06] tracking-[-0.035em] text-[clamp(40px,8vw,64px)]">
        Pay strangers<br />to compute.<br /><span className="font-medium text-[var(--accent)]">Prove they did.</span>
      </h1>
      <p className="mt-5 text-[17px] text-[var(--text-dim)] max-w-[48ch]">
        Strangers run slices of your search in a browser tab, paid per verified chunk. Re-checking the work costs under 1% — not 200%.
      </p>
      <div className="mt-7 flex gap-3 flex-wrap">
        <Link href="/contribute" className="sheen font-medium text-[14px] px-5 py-[11px] text-[var(--bg)]" style={{ background: "var(--accent)" }}>Start contributing</Link>
        <Link href="/how-it-works" className="font-medium text-[14px] px-5 py-[11px] border border-[var(--border-bright)] text-[var(--text)]">How it works</Link>
      </div>

      <div className="hero-sieve" aria-hidden>
        {DROPS.map((s, i) => (
          <span
            key={i}
            className={`hs-drop hs-${s.k === "pass" ? "pass" : "catch"}`}
            style={{ left: `${s.x}%`, animationDelay: `${s.d}s`, background: DROP_COLOR[s.k] }}
          />
        ))}
        <div className="hs-line" />
      </div>
    </section>
  );
}
