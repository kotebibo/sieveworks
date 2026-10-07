import { SolanaMark } from "@/components/SolanaMark";

/**
 * Hero illustration: one big job in the center, crunched by a crowd of everyday
 * computers around it, paid in SOL. Conveys "a crowd does your job" at a glance.
 * Drawn SVG, reuses SolanaMark for coins. Light motion gated in globals.
 */

function Computer({ x, y, dot }: { x: number; y: number; dot?: "v" | "r" }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="44" height="32" rx="5" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
      <rect x="5" y="5" width="34" height="22" rx="2" fill="var(--accent-ghost)" />
      {dot && <circle cx="22" cy="16" r="4" fill={dot === "v" ? "var(--verified)" : "var(--amber)"} />}
    </g>
  );
}

function Coin({ x, y, id }: { x: number; y: number; id: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="12" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" />
      <SolanaMark id={id} w={14} />
    </g>
  );
}

export function HeroSwarm() {
  return (
    <svg viewBox="0 0 1080 240" width="100%" role="img"
      aria-label="One big job in the center, crunched by a crowd of computers around it, paid in Solana."
      style={{ display: "block", overflow: "visible" }}>
      <g className="hs-links" stroke="var(--accent)" strokeWidth="1.5" opacity="0.28">
        <line x1="540" y1="120" x2="150" y2="60" /><line x1="540" y1="120" x2="120" y2="150" />
        <line x1="540" y1="120" x2="220" y2="200" /><line x1="540" y1="120" x2="930" y2="60" />
        <line x1="540" y1="120" x2="965" y2="150" /><line x1="540" y1="120" x2="860" y2="205" />
        <line x1="540" y1="120" x2="400" y2="40" /><line x1="540" y1="120" x2="690" y2="40" />
      </g>

      {/* the job, center */}
      <g transform="translate(486,70)">
        <rect width="108" height="100" rx="14" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2.5" />
        <circle cx="54" cy="46" r="20" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        <line x1="69" y1="61" x2="84" y2="76" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        <text x="54" y="92" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="11" fill="var(--text-faint)">your job</text>
      </g>

      {/* crowd */}
      <Computer x={96} y={34} /><Computer x={74} y={126} dot="v" /><Computer x={180} y={178} />
      <Computer x={360} y={14} dot="v" /><Computer x={650} y={14} /><Computer x={892} y={34} />
      <Computer x={936} y={126} dot="r" /><Computer x={830} y={183} />

      <Coin x={250} y={96} id="hs-coin-1" />
      <Coin x={812} y={150} id="hs-coin-2" />
    </svg>
  );
}
