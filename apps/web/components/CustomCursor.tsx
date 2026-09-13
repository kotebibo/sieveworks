"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A refined custom cursor: an instant dot + a lerp-trailing ring that grows and
 * tints accent over interactive elements. Replaces the native cursor only on
 * fine pointers with motion allowed (text inputs keep their I-beam via CSS).
 * Purely decorative — every click/hover still works with it removed.
 */
export function CustomCursor() {
  const [on, setOn] = useState(false);
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia?.("(pointer: fine)").matches;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;
    setOn(true);
    document.documentElement.classList.add("has-custom-cursor");

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY;
      if (dot.current) dot.current.style.transform = `translate(${mx}px, ${my}px)`;
    };
    const onOver = (e: MouseEvent) => {
      const t = (e.target as HTMLElement)?.closest?.("a,button,[role=button],[data-cursor],input,textarea,select,label");
      ring.current?.classList.toggle("cursor-hot", !!t && !(t as HTMLElement).matches("input,textarea,select"));
    };
    const onDown = () => ring.current?.classList.add("cursor-press");
    const onUp = () => ring.current?.classList.remove("cursor-press");
    const loop = () => {
      rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
      if (ring.current) ring.current.style.transform = `translate(${rx}px, ${ry}px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      document.documentElement.classList.remove("has-custom-cursor");
    };
  }, []);

  if (!on) return null;
  return (
    <>
      <div ref={ring} className="cursor-ring" aria-hidden><span className="cursor-ring-vis" /></div>
      <div ref={dot} className="cursor-dot" aria-hidden />
    </>
  );
}
