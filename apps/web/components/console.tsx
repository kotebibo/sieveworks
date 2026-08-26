"use client";

import { useEffect, useRef, useState } from "react";

/** Labeled panel with a header bar and corner ticks — the console's base unit. */
export function Panel({
  label,
  right,
  children,
  ticked = true,
  className = "",
  bodyClass = "",
}: {
  label?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  ticked?: boolean;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel ${ticked ? "ticked" : ""} ${className}`}>
      {label && (
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
          <span className="barlabel">{label}</span>
          <span className="barlabel text-[var(--text-faint)]">{right}</span>
        </div>
      )}
      <div className={bodyClass || "p-3"}>{children}</div>
    </section>
  );
}

/** Big animated readout — the hero metric. Flashes accent on change. */
export function Readout({ label, value, unit, accent = true }: { label: string; value: string; unit?: string; accent?: boolean }) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(true);
      prev.current = value;
      const t = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <div className={flash ? "flash" : ""}>
      <div className="barlabel">{label}</div>
      <div className="num font-display mt-1 leading-none flex items-baseline gap-1.5">
        <span className="text-3xl sm:text-4xl" style={accent ? { color: "var(--accent)" } : undefined}>{value}</span>
        {unit && <span className="text-xs text-[var(--text-dim)]">{unit}</span>}
      </div>
    </div>
  );
}

const CELL: Record<string, string> = {
  a: "var(--verified)", // accepted
  l: "var(--accent)", // leased
  s: "var(--accent-2)", // submitted
  v: "var(--amber)", // verifying/challenged
  r: "var(--rejected)", // rejected
  q: "var(--rejected)", // quarantined
  p: "var(--cell-empty)", // pending — a visible empty slot, not near-black
};

/** The live swarm grid — one cell per work unit, lit by state. The search
 * space filling in. THE hero visual. */
export function SwarmGrid({ cells }: { cells: string }) {
  const prev = useRef(cells);
  const [popped, setPopped] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (prev.current && prev.current.length === cells.length) {
      const changed = new Set<number>();
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== prev.current[i] && cells[i] === "a") changed.add(i);
      }
      if (changed.size) {
        setPopped(changed);
        const t = setTimeout(() => setPopped(new Set()), 500);
        prev.current = cells;
        return () => clearTimeout(t);
      }
    }
    prev.current = cells;
  }, [cells]);

  const n = cells.length || 400;
  const arr = cells || "p".repeat(400);
  // wide, short grid — a dense field of slots that light up as they verify
  const cols = Math.min(64, Math.max(24, Math.ceil(Math.sqrt(n) * 2.1)));
  return (
    <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from(arr).map((c, i) => (
        <div
          key={i}
          className={`aspect-square ${popped.has(i) ? "cell-pop" : ""}`}
          style={{ backgroundColor: CELL[c] ?? "var(--cell-empty)" }}
          title={c}
        />
      ))}
    </div>
  );
}

export function LiveNum({ value, className = "" }: { value: string; className?: string }) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(true);
      prev.current = value;
      const t = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(t);
    }
  }, [value]);
  return <span className={`num ${flash ? "flash" : ""} ${className}`}>{value}</span>;
}

export function KpiStrip({ items }: { items: { label: string; value: string; accent?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[var(--border)] panel ticked">
      {items.map((it) => (
        <div key={it.label} className="px-3 py-2.5 min-w-0">
          <div className="barlabel truncate">{it.label}</div>
          <div className="num font-display text-lg sm:text-xl mt-0.5 truncate" style={it.accent ? { color: "var(--accent)" } : undefined}>
            <LiveNum value={it.value} />
          </div>
        </div>
      ))}
    </div>
  );
}
