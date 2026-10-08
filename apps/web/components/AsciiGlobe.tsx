"use client";

import { useEffect, useRef } from "react";
import { isLand } from "./globe/landmask";

/**
 * An ASCII-art Earth: a rotating, light-shaded globe drawn in monospace
 * characters (denser glyphs = land), with contributor cities flashing in brand
 * accent and verified-green on top. The base grid is one <pre> rebuilt per
 * frame (cheap); the markers are a few overlaid glyphs positioned on the
 * character grid via ch/em units. Holds a single static frame under
 * prefers-reduced-motion. Decorative only (aria-hidden).
 */

const W = 74;
const H = 37;
const LH = 1.2; // line-height that makes the W×H grid render ~square
const RAMP = " .:-=+*#%@";

// contributor cities [lat, lon, green?]
const CITIES: [number, number, boolean][] = [
  [41.7, 44.8, true], // Tbilisi (home) — verified-green
  [37.78, -122.41, false], // San Francisco
  [40.71, -74.0, false], // New York
  [51.51, -0.13, false], // London
  [35.68, 139.69, true], // Tokyo — green
  [1.35, 103.82, false], // Singapore
  [12.97, 77.59, false], // Bangalore
  [-23.55, -46.63, true], // São Paulo — green
  [-33.87, 151.21, false], // Sydney
];

function rotY(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

export function AsciiGlobe() {
  const preRef = useRef<HTMLPreElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const pre = preRef.current, wrap = wrapRef.current;
    if (!pre || !wrap) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // light direction (upper-left), normalized
    let Lx = -0.3, Ly = 0.45, Lz = 0.84;
    const ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    const cx = (W - 1) / 2, cy = (H - 1) / 2;

    // size the font on the wrapper so <pre> and the markers share ch/em units
    const fit = () => { wrap.style.fontSize = `${Math.max(5, wrap.clientWidth / (W * 0.6))}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const drawBase = (phi: number) => {
      let out = "";
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const nx = (xx - cx) / cx;
          const ny = (yy - cy) / cy;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) { out += " "; continue; }
          const nz = Math.sqrt(1 - r2);
          const [tx, ty, tz] = rotY(nx, -ny, nz, -phi);
          const lat = Math.asin(Math.max(-1, Math.min(1, ty))) * 180 / Math.PI;
          const lon = Math.atan2(tz, tx) * 180 / Math.PI;
          let b = nx * Lx + -ny * Ly + nz * Lz; b = Math.max(0, Math.min(1, b));
          const shade = isLand(lat, lon) ? 0.46 + 0.54 * b : 0.05 + 0.3 * b;
          out += RAMP[Math.max(0, Math.min(9, Math.floor(shade * 9)))];
        }
        out += "\n";
      }
      pre.textContent = out;
    };

    const drawMarkers = (phi: number) => {
      for (let i = 0; i < CITIES.length; i++) {
        const el = markerRefs.current[i];
        if (!el) continue;
        const [lat, lon] = CITIES[i];
        const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
        let [x, y, z] = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
        [x, y, z] = rotY(x, y, z, phi);
        if (z < 0.14) { el.style.opacity = "0"; continue; }
        const sx = x * cx + cx;
        const sy = -y * cy + cy;
        el.style.left = `${sx}ch`;
        el.style.top = `${sy * LH}em`;
        el.style.opacity = "";
      }
    };

    let phi = -1.1, raf = 0, last = 0;
    const draw = (p: number) => { drawBase(p); drawMarkers(p); };
    draw(phi);
    if (!reduce) {
      const loop = (t: number) => {
        if (t - last > 42) { last = t; phi += 0.013; draw(phi); }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div ref={wrapRef} className="ascii-globe" aria-hidden>
      <pre ref={preRef} className="ascii-base" style={{ lineHeight: LH }} />
      {CITIES.map((c, i) => (
        <span
          key={i}
          ref={(el) => { markerRefs.current[i] = el; }}
          className="ascii-marker"
          style={{ color: c[2] ? "var(--verified)" : "var(--accent)", animationDelay: `${(i * 0.37).toFixed(2)}s`, lineHeight: LH }}
        >
          ●
        </span>
      ))}
    </div>
  );
}
