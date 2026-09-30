/**
 * "Real budgets, settled on Solana" as a drawn flow that echoes the hero ribbon:
 * escrow → on-chain record → claimed to a wallet. Drawn icons, plain caption row
 * (not cards). Replaces the old 3-card grid.
 */

const STEPS = [
  { t: "Funded", d: "budget locked in an on-chain escrow before any work starts" },
  { t: "Attested", d: "every record find written to Solana — who found what, forever" },
  { t: "Claimed", d: "withdraw with a co-signed voucher — replay-proof, no double-spends" },
];

export function MoneyFlow() {
  return (
    <div className="mt-10">
      <svg viewBox="0 0 1000 150" width="100%" role="img"
        aria-label="Budget is locked in escrow, then each find is attested on Solana, then workers claim their payout to a wallet."
        style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="mf-ribbon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="1" stopColor="var(--verified)" stopOpacity="0.42" />
          </linearGradient>
        </defs>
        <path className="hf-ribbon" d="M120 74 H880" fill="none" stroke="url(#mf-ribbon)" strokeWidth="11" strokeLinecap="round" pathLength={1} />
        <g fill="var(--accent)" opacity="0.6">
          <path d="M322 68 l11 6 l-11 6 z" />
          <path d="M686 68 l11 6 l-11 6 z" fill="var(--verified)" />
        </g>

        {/* 1 · escrow vault */}
        <g transform="translate(120,74)">
          <rect x="-33" y="-37" width="66" height="74" rx="12" fill="var(--panel-2)" stroke="var(--border-bright)" strokeWidth="2" />
          <circle cx="0" cy="0" r="17" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" />
          <circle cx="0" cy="0" r="8" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle cx="0" cy="0" r="2.4" fill="var(--accent)" />
          <g stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
            <line x1="0" y1="-22" x2="0" y2="-27" /><line x1="0" y1="22" x2="0" y2="27" />
            <line x1="-22" y1="0" x2="-27" y2="0" /><line x1="22" y1="0" x2="27" y2="0" />
          </g>
        </g>

        {/* 2 · on-chain record */}
        <g transform="translate(500,74)">
          <rect x="-34" y="-30" width="68" height="60" rx="10" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
          <line x1="-20" y1="-12" x2="14" y2="-12" stroke="var(--border-bright)" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="-20" y1="-1" x2="8" y2="-1" stroke="var(--border-bright)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M-20 12 l7 7 l14 -16" fill="none" stroke="var(--verified)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* on-chain link badge */}
          <g transform="translate(20,14)" stroke="var(--accent)" strokeWidth="2.2" fill="none">
            <rect x="-8" y="-4" width="10" height="8" rx="4" /><rect x="-2" y="-4" width="10" height="8" rx="4" />
          </g>
        </g>

        {/* 3 · claimed to a wallet */}
        <g transform="translate(880,74)">
          <rect x="-34" y="-26" width="68" height="52" rx="10" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
          <path d="M6 -6 h24 a4 4 0 0 1 4 4 v4 a4 4 0 0 1 -4 4 h-24 z" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" />
          <circle cx="18" cy="0" r="3" fill="var(--accent)" />
          {/* incoming coin */}
          <g transform="translate(-24,-2)">
            <circle cx="0" cy="0" r="12" fill="var(--accent-ghost)" stroke="var(--accent)" strokeWidth="2" />
            <circle cx="0" cy="0" r="5.5" fill="none" stroke="var(--accent)" strokeWidth="2" />
          </g>
        </g>
      </svg>

      <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-3 text-center">
        {STEPS.map((s) => (
          <div key={s.t}>
            <div className="font-display font-bold text-[15px]">{s.t}</div>
            <div className="mt-1 text-[13px] leading-[1.5] text-[var(--text-dim)]">{s.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
