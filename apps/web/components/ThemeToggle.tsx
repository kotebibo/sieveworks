"use client";

import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="text-xs px-2 py-1 border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]"
      aria-label="toggle theme"
      title={`switch to ${theme === "dark" ? "light" : "dark"}`}
    >
      {theme === "dark" ? "☀ light" : "☾ dark"}
    </button>
  );
}
