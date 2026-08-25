"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

/** Applied before paint by an inline script in <head> to avoid a flash; this
 * provider just keeps React state in sync and persists the choice. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (localStorage.getItem("sieveworks-theme") as Theme | null) ?? "dark";
    setTheme(stored);
  }, []);

  const toggle = () => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("sieveworks-theme", next);
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(next);
      return next;
    });
  };

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Inline, runs before first paint — reads storage and sets the class so the
 * correct theme is present in the very first frame (no flash, no CLS). */
export const themeInitScript = `
(function(){try{var t=localStorage.getItem('sieveworks-theme')||'dark';
document.documentElement.classList.add(t);}catch(e){document.documentElement.classList.add('dark');}})();
`;
