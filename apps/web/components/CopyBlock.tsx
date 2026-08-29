"use client";

import { useState } from "react";

/** A preformatted block with a copy button. `collapsible` starts it folded to a
 * preview with a fade, so long content (the AI module prompt) doesn't swallow
 * the page. Copy always copies the full text regardless of fold state. */
export function CopyBlock({ text, label, collapsible = false }: { text: string; label: string; collapsible?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(!collapsible);
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
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2">
        <span className="num text-[12px] text-[var(--text-faint)]">{label}</span>
        <div className="flex items-center gap-2">
          {collapsible && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="num text-[12px] px-2.5 py-1 border border-[var(--border-bright)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text)]"
            >
              {open ? "collapse" : "show full prompt"}
            </button>
          )}
          <button
            onClick={copy}
            className="num text-[12px] px-2.5 py-1 border border-[var(--border-bright)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>
      <div className="relative overflow-hidden" style={open ? undefined : { maxHeight: 220 }}>
        <pre className="num text-[13px] leading-[1.6] p-4 overflow-x-auto scroll-thin whitespace-pre-wrap">{text}</pre>
        {!open && (
          <div
            className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
            style={{ background: "linear-gradient(180deg, transparent, var(--panel-2))" }}
          />
        )}
      </div>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="w-full border-t border-[var(--border)] py-2 num text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)]"
        >
          ▾ show the full prompt
        </button>
      )}
    </div>
  );
}
