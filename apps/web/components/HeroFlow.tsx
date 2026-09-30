/**
 * Hero illustration: Funded → Sieved → Verified & paid as ONE continuous drawn
 * scene (illustration-led, Direction B toned down) — a ribbon carries seeds from
 * a funded escrow, through a sieve where good ones catch, to a verified check and
 * payout. No cards. Drawn icons only. Motion is one authored moment, gated behind
 * prefers-reduced-motion (see globals.css .hf-*).
 */

function Coin({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" />
      <circle cx={x} cy={y} r={r * 0.5} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <circle cx={x} cy={y} r={r * 0.14} fill="var(--accent)" />
    </g>
  );
}

export function HeroFlow() {
  return (
    <div>
      <svg
        viewBox="0 0 1000 196"
        width="100%"
        role="img"
        aria-label="A funded bounty's seeds flow through a sieve where good ones catch, then reach a verified check and payout."
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="hf-ribbon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="0.5" stopColor="var(--accent)" stopOpacity="0.34" />
            <stop offset="1" stopColor="var(--verified)" stopOpacity="0.30" />
          </linearGradient>
        </defs>

        {/* the connecting ribbon */}
        <path className="hf-ribbon" d="M96 106 C 250 58, 340 58, 470 106 S 700 154, 904 106"
          fill="none" stroke="url(#hf-ribbon)" strokeWidth="13" strokeLinecap="round" pathLength={1} />

        {/* seeds riding the ribbon */}
        <g className="hf-seeds" fill="var(--accent)">
          <circle cx="232" cy="76" r="4" />
          <circle cx="322" cy="69" r="4" opacity="0.7" />
          <circle cx="648" cy="140" r="4" opacity="0.6" />
          <circle cx="768" cy="133" r="4" fill="var(--verified)" />
        </g>

        {/* 1 · funded — coin under a lock */}
        <Coin x={70} y={106} r={30} />
        <path d="M55 85 v-6 a15 15 0 0 1 30 0 v6" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />

        {/* 2 · sieved — funnel + mesh, seeds pour in, good ones catch */}
        <g transform="translate(438,36)">
          <g className="hf-seeds" fill="var(--accent-2)">
            <circle cx="42" cy="4" r="3.4" /><circle cx="66" cy="-2" r="3.4" /><circle cx="90" cy="8" r="3.4" />
            <circle cx="54" cy="22" r="3.2" opacity="0.8" /><circle cx="80" cy="20" r="3.2" opacity="0.8" />
          </g>
          <path d="M12 46 L116 46 L80 108 L48 108 Z" fill="var(--panel)" stroke="var(--border-bright)" strokeWidth="2" />
          <g stroke="var(--accent)" strokeWidth="1.5" opacity="0.5">
            <line x1="18" y1="55" x2="110" y2="55" /><line x1="24" y1="66" x2="104" y2="66" /><line x1="31" y1="77" x2="97" y2="77" />
          </g>
          <circle cx="44" cy="55" r="4.5" fill="var(--verified)" />
          <circle cx="84" cy="55" r="4.5" fill="var(--amber)" />
          <circle cx="64" cy="66" r="4.5" fill="var(--verified)" />
          <circle className="hf-drop" cx="64" cy="112" r="4" fill="var(--accent)" />
        </g>

        {/* 3 · verified & paid — check + coin */}
        <g transform="translate(864,76)">
          <circle cx="40" cy="30" r="30" fill="rgba(30,158,92,0.12)" stroke="var(--verified)" strokeWidth="2" />
          <path d="M27 31 l9 9 l17 -20" fill="none" stroke="var(--verified)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <Coin x={938} y={128} r={16} />
      </svg>

      {/* three moments — plain captions, not cards */}
      <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-3 text-center">
        <div>
          <div className="font-display font-bold text-[15px]">Funded</div>
          <div className="mt-1 text-[13px] text-[var(--text-dim)]">budget locked in escrow</div>
        </div>
        <div>
          <div className="font-display font-bold text-[15px]">Sieved</div>
          <div className="mt-1 text-[13px] text-[var(--text-dim)]">a swarm runs slices — each answer carries a witness</div>
        </div>
        <div>
          <div className="font-display font-bold text-[15px]">Verified &amp; paid</div>
          <div className="mt-1 text-[13px] text-[var(--text-dim)]">the witness re-checks in <span className="num">0.4ms</span></div>
        </div>
      </div>
    </div>
  );
}
