"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

export function truncate(s: string, head = 4, tail = 4): string {
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return tail === 0 ? `${s.slice(0, head)}…` : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function fmt(n: number | string): string {
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? v.toLocaleString("en-US") : "—";
}

/** A number that flashes when its value changes. Used for every live metric. */
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

export function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">{label}</div>
      <div className="mt-1 text-xl" style={accent ? { color: "var(--accent)" } : undefined}>
        <LiveNum value={value} />
      </div>
    </div>
  );
}

/** Truncated, copyable, explorer-linked identifier — for every seed/wallet/sig. */
export function Mono({
  value,
  kind,
  head = 4,
  tail = 4,
}: {
  value: string;
  kind?: "address" | "tx";
  head?: number;
  tail?: number;
}) {
  const [copied, setCopied] = useState(false);
  const short = truncate(value, head, tail);
  const href =
    kind === "address"
      ? `https://explorer.solana.com/address/${value}?cluster=${CLUSTER}`
      : kind === "tx"
        ? `https://explorer.solana.com/tx/${value}?cluster=${CLUSTER}`
        : null;
  const copy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  const inner = (
    <span className="num text-[var(--text-dim)] hover:text-[var(--text)]" title={value}>
      {copied ? "copied" : short}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        inner
      )}
      <button onClick={copy} className="text-[var(--text-faint)] hover:text-[var(--accent)] text-xs" aria-label="copy">
        ⧉
      </button>
    </span>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full bg-[var(--panel-2)]">
      <div
        className="h-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Badge({ state }: { state: string }) {
  const color =
    state === "accepted" || state === "passed"
      ? "var(--verified)"
      : state === "rejected" || state === "failed"
        ? "var(--rejected)"
        : state === "leased" || state === "verifying" || state === "challenged"
          ? "var(--accent)"
          : "var(--text-dim)";
  return (
    <span className="num text-[11px] px-1.5 py-0.5 border" style={{ color, borderColor: color }}>
      {state}
    </span>
  );
}

export function Button({
  href,
  onClick,
  children,
  variant = "primary",
  disabled,
  title,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  const base = "inline-flex items-center gap-2 px-4 py-2 text-sm border transition-colors disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--bg)]"
      : variant === "danger"
        ? "border-[var(--rejected)] text-[var(--rejected)] hover:bg-[var(--rejected)] hover:text-[var(--bg)]"
        : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]";
  const cls = `${base} ${styles}`;
  if (href) return <Link href={href} className={cls} title={title}>{children}</Link>;
  return <button className={cls} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}
