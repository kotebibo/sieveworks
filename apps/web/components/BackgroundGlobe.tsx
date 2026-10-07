"use client";

import { useEffect, useRef } from "react";

/**
 * A subtle 3D dotted-earth globe (cobe, WebGL) for the hero backdrop. Continents
 * are drawn as dot clusters; a few markers are contributor cities. Auto-rotates,
 * lazy-imported so it stays off the critical path, and holds still under
 * prefers-reduced-motion. Decorative only (aria-hidden).
 */
export function BackgroundGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let destroyed = false;
    let globe: { destroy: () => void } | null = null;
    let width = canvas.offsetWidth || 500;
    const onResize = () => { width = canvas.offsetWidth || width; };
    window.addEventListener("resize", onResize);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let phi = 0;

    import("cobe").then(({ default: createGlobe }) => {
      if (destroyed || !canvasRef.current) return;
      const opts: Parameters<typeof createGlobe>[1] = {
        devicePixelRatio: 2,
        width: width * 2,
        height: width * 2,
        phi: 0,
        theta: 0.2,
        dark: 0,
        diffuse: 1.2,
        mapSamples: 16000,
        mapBrightness: 6,
        baseColor: [0.55, 0.7, 0.92],
        markerColor: [0.12, 0.62, 0.36],
        glowColor: [0.92, 0.96, 1],
        markers: [
          { location: [41.7, 44.8], size: 0.06 },     // Tbilisi
          { location: [37.78, -122.41], size: 0.05 },  // San Francisco
          { location: [51.51, -0.13], size: 0.045 },   // London
          { location: [35.68, 139.69], size: 0.045 },  // Tokyo
          { location: [-23.55, -46.63], size: 0.045 }, // São Paulo
          { location: [1.35, 103.82], size: 0.04 },    // Singapore
        ],
      };
      // cobe supports onRender at runtime; its published types omit it.
      (opts as { onRender?: (state: Record<string, number>) => void }).onRender = (state) => {
        if (!reduce) phi += 0.0022;
        state.phi = phi;
        state.width = width * 2;
        state.height = width * 2;
      };
      globe = createGlobe(canvasRef.current, opts);
    });

    return () => {
      destroyed = true;
      globe?.destroy();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-auto" style={{ aspectRatio: "1" }} aria-hidden />;
}
