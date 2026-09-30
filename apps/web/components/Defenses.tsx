import { Reveal } from "@/components/Reveal";
import { SolanaMark } from "@/components/SolanaMark";

/**
 * "Four ways a lie dies" as an illustrated gauntlet (Direction B, toned down): a
 * fake result runs a track through four drawn gates — witness lens, honeypot,
 * Merkle tree, staked coin slashed — and is caught. Drawn icons in one stroke
 * weight, plain caption row (not cards). Replaces the old 4-card grid.
 */

const GATES = [
  { t: "Witness recheck", d: "the winning seed is re-run; a wrong score is rejected" },
  { t: "Honeypots", d: "known-answer traps salted through the work" },
  { t: "Merkle challenge", d: "random buckets recomputed against your committed root" },
  { t: "Stake & slash", d: "cheat and your on-chain stake burns" },
];

export function Defenses() {
  return (
    <div>
      <Reveal variant="up">
        <h2 className="font-display font-bold text-[clamp(26px,3.6vw,40px)] tracking-[-0.028em]">Four ways a lie dies.</h2>
        <p className="mt-3 text-[16px] text-[var(--text-dim)] max-w-[56ch]">
          Watch a fake result try to make it through. It fails at every gate, for about <span className="num text-[var(--text)]">0.9%</span> extra compute, not 200%.
        </p>
      </Reveal>

      <Reveal variant="fade" delay={80} className="mt-12">
        <svg viewBox="0 0 1000 180" width="100%" role="img"
          aria-label="A fake result runs through four gates — witness recheck, honeypots, Merkle challenge, and stake-and-slash — and is caught at each."
          style={{ display: "block", overflow: "visible" }}>
          {/* the track a result travels */}
          <line x1="40" y1="150" x2="960" y2="150" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="2 9" strokeLinecap="round" opacity="0.45" />
          <circle cx="44" cy="150" r="7" fill="var(--amber)" />

          {/* connectors + markers anchoring each gate to the line */}
          <g stroke="var(--border-bright)" strokeWidth="1.5">
            <line x1="150" y1="100" x2="150" y2="143" />
            <line x1="386" y1="124" x2="386" y2="143" />
            <line x1="622" y1="124" x2="622" y2="143" />
            <line x1="858" y1="112" x2="858" y2="143" />
          </g>
          <g stroke="var(--bg)" strokeWidth="2">
            <circle cx="150" cy="150" r="6" fill="var(--accent)" />
            <circle cx="386" cy="150" r="6" fill="var(--amber)" />
            <circle cx="622" cy="150" r="6" fill="var(--accent)" />
            <circle cx="858" cy="150" r="6" fill="var(--amber)" />
          </g>

          {/* gate 1 — witness lens over a seed */}
          <g transform="translate(150,0)">
            <circle cx="0" cy="74" r="24" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2.5" />
            <circle cx="0" cy="74" r="6" fill="var(--accent)" />
            <line x1="17" y1="91" x2="30" y2="104" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" />
          </g>

          {/* gate 2 — honeypot trap */}
          <g transform="translate(386,0)">
            <path d="M-22 100 L22 100 L15 122 L-15 122 Z" fill="var(--amber)" fillOpacity="0.16" stroke="var(--amber)" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M-20 100 q20 -34 40 0" fill="none" stroke="var(--amber)" strokeWidth="2.5" />
            <circle cx="0" cy="70" r="5.5" fill="var(--amber)" />
          </g>

          {/* gate 3 — merkle tree, one path highlighted */}
          <g transform="translate(622,0)" stroke="var(--accent)" strokeWidth="2.5" fill="none">
            <line x1="0" y1="56" x2="-26" y2="90" /><line x1="0" y1="56" x2="26" y2="90" />
            <line x1="26" y1="90" x2="12" y2="122" /><line x1="26" y1="90" x2="40" y2="122" />
            <circle cx="0" cy="54" r="6" fill="var(--accent)" />
            <circle cx="-26" cy="90" r="5" fill="var(--panel)" />
            <circle cx="26" cy="90" r="5" fill="var(--accent)" />
            <circle cx="12" cy="122" r="4.5" fill="var(--panel)" />
            <circle cx="40" cy="122" r="4.5" fill="var(--accent)" />
          </g>

          {/* gate 4 — staked SOL, slashed */}
          <g transform="translate(858,0)">
            <circle cx="0" cy="86" r="24" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2.5" />
            <g transform="translate(0 86)"><SolanaMark id="sol-stake" w={26} /></g>
            <line className="def-slash" x1="-20" y1="106" x2="20" y2="66" stroke="var(--amber)" strokeWidth="4.5" strokeLinecap="round" />
          </g>
        </svg>
      </Reveal>

      {/* four gates — one caption row, not cards */}
      <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-6">
        {GATES.map((g) => (
          <div key={g.t}>
            <div className="font-display font-bold text-[15.5px]">{g.t}</div>
            <div className="mt-1 text-[13px] leading-[1.5] text-[var(--text-dim)]">{g.d}</div>
          </div>
        ))}
      </div>

      <Reveal variant="fade" delay={60}>
        <p className="mt-9 font-display font-bold text-[17px]" style={{ color: "var(--verified)" }}>Stacked together, the lie never survives.</p>
      </Reveal>
    </div>
  );
}
