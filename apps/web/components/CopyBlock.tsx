"use client";

import { useState } from "react";

/** A preformatted block with a copy button. Used for the AI module prompt. */
export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable; user can select manually */
    }
  };
  return (
    <div className="relative border border-[var(--border)] bg-[var(--panel-2)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="num text-[11px] text-[var(--text-faint)]">{label}</span>
        <button
          onClick={copy}
          className="num text-[11px] px-2.5 py-1 border border-[var(--border-bright)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="num text-[11.5px] leading-[1.55] p-3 overflow-x-auto scroll-thin whitespace-pre-wrap">{text}</pre>
    </div>
  );
}
