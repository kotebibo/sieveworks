"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The signature: the search space itself, filling in. One cell per chunk,
 * idle → outlined while leased → green when verified, brass for a record,
 * red when a fabricated result is caught. Driven by REAL swarm data (a string
 * of per-chunk state codes) — not simulated.
 */

const FILL: Record<string, string> = {
  a: "var(--verified)",
  s: "var(--accent-2)",
  v: "var(--accent)",
  r: "var(--rejected)",
  q: "var(--rejected)",
  p: "var(--cell-empty)",
  l: "transparent",
};

// deterministic per-index opacity so verified cells have texture without
// causing hydration mismatch
function op(i: number, code: string): number {
  if (code !== "a") return 1;
  return 0.4 + (((i * 2654435761) >>> 0) % 1000) / 1000 * 0.55;
}

export function Sieve({ cells, cols = 46 }: { cells: string; cols?: number }) {
  const arr = cells && cells.length ? cells : "p".repeat(cols * 14);
  const prev = useRef(arr);
  const [popped, setPopped] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (prev.current.length === arr.length) {
      const changed = new Set<number>();
      for (let i = 0; i < arr.length; i++) if (arr[i] !== prev.current[i] && arr[i] === "a") changed.add(i);
      if (changed.size) {
        setPopped(changed);
        const t = setTimeout(() => setPopped(new Set()), 450);
        prev.current = arr;
        return () => clearTimeout(t);
      }
    }
    prev.current = arr;
  }, [arr]);

  const rows = Math.ceil(arr.length / cols);
  const CELL = 9, GAP = 1;
  const w = cols * (CELL + GAP) - GAP;
  const h = rows * (CELL + GAP) - GAP;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Live grid of the search space, filling in as chunks verify" style={{ display: "block" }}>
      {Array.from(arr).map((code, i) => {
        const x = (i % cols) * (CELL + GAP);
        const y = Math.floor(i / cols) * (CELL + GAP);
        const searching = code === "l";
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            fill={FILL[code] ?? "var(--cell-empty)"}
            fillOpacity={op(i, code)}
            stroke={searching ? "var(--accent-dim)" : undefined}
            strokeWidth={searching ? 1 : undefined}
            className={`sieve-cell${popped.has(i) ? " cell-pop" : ""}`}
            style={popped.has(i) ? { transformOrigin: `${x + CELL / 2}px ${y + CELL / 2}px` } : undefined}
          />
        );
      })}
    </svg>
  );
}
