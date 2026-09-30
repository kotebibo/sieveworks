/**
 * The official Solana logomark (three bars, green→purple gradient), as an inline
 * SVG <g> to drop inside any <svg>. Centered on the origin and scaled to width
 * `w`, so place it with a parent transform. Each instance needs a unique `id`
 * (the gradient is document-scoped).
 */
export function SolanaMark({ id, w = 22 }: { id: string; w?: number }) {
  const s = w / 397.7;
  const h = 311.7 * s;
  return (
    <g transform={`translate(${-w / 2} ${-h / 2}) scale(${s})`}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="360.88" y1="-37.46" x2="141.21" y2="383.29">
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z" />
      <path fill={`url(#${id})`} d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z" />
      <path fill={`url(#${id})`} d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z" />
    </g>
  );
}
