"use client";

import { useEffect, useRef } from "react";
import { isLand } from "./globe/landmask";

/**
 * An ASCII-art Earth: a rotating, light-shaded globe drawn in monospace
 * characters. Two overlaid <pre> layers colour it — green continents, blue
 * oceans (denser glyphs = more lit) — and contributor cities flash in amber on
 * top. Layers are rebuilt per frame in one pass; markers are overlaid on the
 * character grid via ch/em units. Static frame under reduced motion.
 * Decorative only (aria-hidden).
 */

const W = 120;
const H = 60;
const LH = 1.2; // line-height that renders the W×H grid ~square
const RAMP = " .,:;-~=+*oc#%&@";
const RN = RAMP.length - 1;

// contributor cities [lat, lon]
const CITIES: [number, number][] = [
  [41.7, 44.8], // Tbilisi
  [37.78, -122.41], // San Francisco
  [40.71, -74.0], // New York
  [51.51, -0.13], // London
  [35.68, 139.69], // Tokyo
  [1.35, 103.82], // Singapore
  [12.97, 77.59], // Bangalore
  [-23.55, -46.63], // São Paulo
  [-33.87, 151.21], // Sydney
];

function rotY(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

export function AsciiGlobe() {
  const landRef = useRef<HTMLPreElement>(null);
  const oceanRef = useRef<HTMLPreElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const land = landRef.current, ocean = oceanRef.current, wrap = wrapRef.current;
    if (!land || !ocean || !wrap) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let Lx = -0.3, Ly = 0.45, Lz = 0.84;
    const ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    const cx = (W - 1) / 2, cy = (H - 1) / 2;

    // size the font on the wrapper so both <pre> and the markers share ch/em units
    const fit = () => { wrap.style.fontSize = `${Math.max(3, wrap.clientWidth / (W * 0.6))}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const drawBase = (phi: number) => {
      let lo = "", oc = "";
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const nx = (xx - cx) / cx;
          const ny = (yy - cy) / cy;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) { lo += " "; oc += " "; continue; }
          const nz = Math.sqrt(1 - r2);
          const [tx, ty, tz] = rotY(nx, -ny, nz, -phi);
          const lat = Math.asin(Math.max(-1, Math.min(1, ty))) * 180 / Math.PI;
          const lon = Math.atan2(tz, tx) * 180 / Math.PI;
          let b = nx * Lx + -ny * Ly + nz * Lz; b = Math.max(0, Math.min(1, b));
          if (isLand(lat, lon)) {
            lo += RAMP[Math.min(RN, Math.floor((0.5 + 0.5 * b) * RN))];
            oc += " ";
          } else {
            oc += RAMP[Math.min(RN, Math.floor((0.42 + 0.45 * b) * RN))];
            lo += " ";
          }
        }
        lo += "\n"; oc += "\n";
      }
      land.textContent = lo;
      ocean.textContent = oc;
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
        el.style.left = `${x * cx + cx}ch`;
        el.style.top = `${(-y * cy + cy) * LH}em`;
        el.style.opacity = "";
      }
    };

    let phi = -1.1, raf = 0, last = 0;
    const draw = (p: number) => { drawBase(p); drawMarkers(p); };
    draw(phi);
    if (!reduce) {
      const loop = (t: number) => {
        if (t - last > 45) { last = t; phi += 0.011; draw(phi); }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div ref={wrapRef} className="ascii-globe" aria-hidden>
      <pre ref={oceanRef} className="ascii-base ascii-ocean" style={{ lineHeight: LH }} />
      <pre ref={landRef} className="ascii-base ascii-land" style={{ lineHeight: LH }} />
      {CITIES.map((_, i) => (
        <span
          key={i}
          ref={(el) => { markerRefs.current[i] = el; }}
          className="ascii-marker"
          style={{ animationDelay: `${(i * 0.37).toFixed(2)}s`, lineHeight: LH }}
        >
          ●
        </span>
      ))}
    </div>
  );
}
