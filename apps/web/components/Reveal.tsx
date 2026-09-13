"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll-reveal: animates its content in the first time it enters the viewport.
 * Variety by `variant` (up / left / right / scale / fade); `delay` staggers
 * siblings. Pure CSS transition toggled by a class, so it stays smooth and is
 * fully disabled under prefers-reduced-motion (see globals.css .reveal-on).
 */
export function Reveal({
  children,
  variant = "up",
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  variant?: "up" | "left" | "right" | "scale" | "fade";
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) { setSeen(true); io.disconnect(); }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`reveal-on rv-${variant} ${seen ? "is-in" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
