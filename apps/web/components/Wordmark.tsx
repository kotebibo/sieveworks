/** The sieve mark: a 3×3 mesh with one brass cell and one half-tone cell —
 * mesh and search space at once. Renders crisp at 16px. */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" className="wordmark-spin" style={{ transformOrigin: "center" }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.45">
        <path d="M1 6h20M1 11h20M1 16h20M6 1v20M11 1v20M16 1v20" />
      </g>
      <rect x="6" y="6" width="5" height="5" fill="var(--accent)" />
      <rect x="11" y="11" width="5" height="5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
