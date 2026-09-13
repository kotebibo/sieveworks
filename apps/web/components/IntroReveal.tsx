"use client";

import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";

/**
 * A brief branded curtain on first load of the session: a sieve motif sweeps,
 * the wordmark resolves, then it lifts. ~1.3s, skippable (click / scroll / key),
 * once per session. Skipped entirely under prefers-reduced-motion so it never
 * gets between a returning/impaired visitor and the page.
 */
export function IntroReveal() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("gone");

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || sessionStorage.getItem("sw_intro_seen")) return;
    sessionStorage.setItem("sw_intro_seen", "1");
    setPhase("in");
    document.body.style.overflow = "hidden";

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setPhase("out");
      document.body.style.overflow = "";
      window.setTimeout(() => setPhase("gone"), 620);
    };
    const t = window.setTimeout(finish, 1350);
    window.addEventListener("wheel", finish, { passive: true, once: true });
    window.addEventListener("touchstart", finish, { passive: true, once: true });
    window.addEventListener("keydown", finish, { once: true });
    window.addEventListener("click", finish, { once: true });
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = "";
      window.removeEventListener("wheel", finish);
      window.removeEventListener("keydown", finish);
      window.removeEventListener("click", finish);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <div className={`intro-curtain ${phase === "out" ? "intro-out" : ""}`} aria-hidden>
      <div className="intro-mark">
        <span className="intro-glyph"><Wordmark /></span>
        <span className="intro-word font-display font-extrabold tracking-[0.14em] uppercase">Sieveworks</span>
      </div>
      <div className="intro-line" />
    </div>
  );
}
