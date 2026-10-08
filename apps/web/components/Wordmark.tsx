/**
 * The Sieveworks mark: a meridian globe wired into a small network around a
 * verified core — a worldwide compute network whose work is proven. Structure
 * (globe + spokes + outline nodes) inherits currentColor; the core is the
 * accent and one node is verified-green. Crisp from favicon to hero.
 */
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {/* graticule globe */}
      <g fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4">
        <circle cx="24" cy="24" r="18" />
        <ellipse cx="24" cy="24" rx="7.6" ry="18" />
        <line x1="6" y1="24" x2="42" y2="24" strokeLinecap="round" />
        <path d="M9.6 14.6 Q24 20.4 38.4 14.6" strokeLinecap="round" />
        <path d="M9.6 33.4 Q24 27.6 38.4 33.4" strokeLinecap="round" />
      </g>
      {/* network spokes */}
      <g stroke="currentColor" strokeWidth="1.7" opacity="0.5" strokeLinecap="round">
        <line x1="24" y1="24" x2="35.6" y2="10.2" />
        <line x1="24" y1="24" x2="33" y2="39.6" />
        <line x1="24" y1="24" x2="6" y2="24" />
      </g>
      {/* nodes: one verified-green, two outline */}
      <circle cx="35.6" cy="10.2" r="2.9" fill="var(--verified)" />
      <circle cx="33" cy="39.6" r="2.4" fill="var(--panel)" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="24" r="2.4" fill="var(--panel)" stroke="currentColor" strokeWidth="2" />
      {/* verified core */}
      <circle cx="24" cy="24" r="6.6" fill="var(--accent)" />
      <path d="M20.5 24 l2.44 2.44 l4.75 -5.28" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
