"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { CustomCursor } from "@/components/CustomCursor";
import { IntroReveal } from "@/components/IntroReveal";

/**
 * Global client-only chrome: momentum smooth-scroll (Lenis) + custom cursor +
 * first-load intro. Lenis drives the real scroll position, so the sticky 3D
 * hero, IntersectionObserver reveals, and anchor links all keep working; it's
 * skipped under prefers-reduced-motion so nothing hijacks assistive scrolling.
 */
export function ClientChrome() {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, touchMultiplier: 1.5 });
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    // keep in-page anchor jumps working with Lenis in control
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      const id = a?.getAttribute("href");
      if (id && id.length > 1) { const el = document.querySelector(id); if (el) { e.preventDefault(); lenis.scrollTo(el as HTMLElement, { offset: -70 }); } }
    };
    document.addEventListener("click", onClick);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("click", onClick); lenis.destroy(); };
  }, []);

  return (
    <>
      <CustomCursor />
      <IntroReveal />
    </>
  );
}
