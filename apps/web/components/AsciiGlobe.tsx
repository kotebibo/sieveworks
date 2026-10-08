"use client";

import { useEffect, useRef } from "react";
import { isLand, MASK_W, MASK_H } from "./globe/landmask";

/**
 * An ASCII-art Earth: a rotating, light-shaded globe drawn in monospace
 * characters. Overlaid colored layers render green continents over blue oceans
 * (denser glyphs = more lit), amber great-circle lines trace the network
 * between contributor cities, and the cities themselves flash in amber on top
 * (snapped onto land). Layers rebuild per frame. Static under reduced motion.
 * Decorative only (aria-hidden).
 */

const W = 180;
const H = 90;
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
// the network: index pairs into CITIES
const LINKS: [number, number][] = [
  [0, 3], [3, 2], [2, 1], [1, 4], [4, 5], [5, 6], [6, 0],
  [2, 7], [5, 8], [3, 7], [0, 5], [1, 8], [4, 8], [6, 3], [2, 4], [7, 1],
];

function rotY(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

// nudge a coastal city onto the nearest land cell so its pin sits on a continent
function snapToLand(lat: number, lon: number): [number, number] {
  if (isLand(lat, lon)) return [lat, lon];
  const dLon = 360 / MASK_W, dLat = 180 / MASK_H;
  for (let r = 1; r <= 7; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isLand(lat + dy * dLat, lon + dx * dLon)) return [lat + dy * dLat, lon + dx * dLon];
      }
    }
  }
  return [lat, lon];
}

// texture-space unit vector (pre-spin), matching the base sampler's convention
function texVec(lat: number, lon: number): [number, number, number] {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
}

export function AsciiGlobe() {
  const landRef = useRef<HTMLPreElement>(null);
  const oceanRef = useRef<HTMLPreElement>(null);
  const lineRef = useRef<HTMLPreElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const land = landRef.current, ocean = oceanRef.current, lineEl = lineRef.current, wrap = wrapRef.current;
    if (!land || !ocean || !lineEl || !wrap) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let Lx = -0.3, Ly = 0.45, Lz = 0.84;
    const ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    const cx = (W - 1) / 2, cy = (H - 1) / 2;

    // cities snapped onto land, as texture-space vectors
    const cityVec = CITIES.map(([la, lo]) => texVec(...snapToLand(la, lo)));

    // great-circle arc points (texture space), sampled once with a small lift
    const arcPts: [number, number, number][] = [];
    for (const [i, j] of LINKS) {
      const a = cityVec[i], b = cityVec[j];
      const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const omega = Math.acos(dot), sinO = Math.sin(omega) || 1e-5;
      const lift = 0.05 + omega * 0.05, SEG = 42;
      for (let k = 0; k <= SEG; k++) {
        const t = k / SEG;
        const w1 = Math.sin((1 - t) * omega) / sinO, w2 = Math.sin(t * omega) / sinO;
        let x = a[0] * w1 + b[0] * w2, y = a[1] * w1 + b[1] * w2, z = a[2] * w1 + b[2] * w2;
        const len = Math.hypot(x, y, z) || 1, scale = (1 + lift * Math.sin(Math.PI * t)) / len;
        arcPts.push([x * scale, y * scale, z * scale]);
      }
    }

    const fit = () => { wrap.style.fontSize = `${Math.max(2.5, wrap.clientWidth / (W * 0.6))}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const drawBase = (phi: number) => {
      let lo = "", oc = "";
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const nx = (xx - cx) / cx, ny = (yy - cy) / cy;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) { lo += " "; oc += " "; continue; }
          const nz = Math.sqrt(1 - r2);
          const [tx, ty, tz] = rotY(nx, -ny, nz, -phi);
          const lat = Math.asin(Math.max(-1, Math.min(1, ty))) * 180 / Math.PI;
          const lon = Math.atan2(tz, tx) * 180 / Math.PI;
          let b = nx * Lx + -ny * Ly + nz * Lz; b = Math.max(0, Math.min(1, b));
          if (isLand(lat, lon)) {
            lo += RAMP[Math.min(RN, Math.floor((0.5 + 0.5 * b) * RN))]; oc += " ";
          } else {
            oc += RAMP[Math.min(RN, Math.floor((0.42 + 0.45 * b) * RN))]; lo += " ";
          }
        }
        lo += "\n"; oc += "\n";
      }
      land.textContent = lo;
      ocean.textContent = oc;
    };

    const grid: string[][] = Array.from({ length: H }, () => new Array(W).fill(" "));
    const drawLines = (phi: number) => {
      for (let r = 0; r < H; r++) grid[r].fill(" ");
      for (const p of arcPts) {
        const [x, y, z] = rotY(p[0], p[1], p[2], phi);
        if (z < 0.04) continue;
        const sx = Math.round(x * cx + cx), sy = Math.round(-y * cy + cy);
        if (sy >= 0 && sy < H && sx >= 0 && sx < W) grid[sy][sx] = "·";
      }
      lineEl.textContent = grid.map((r) => r.join("")).join("\n");
    };

    const drawMarkers = (phi: number) => {
      for (let i = 0; i < cityVec.length; i++) {
        const el = markerRefs.current[i];
        if (!el) continue;
        const [x, y, z] = rotY(cityVec[i][0], cityVec[i][1], cityVec[i][2], phi);
        if (z < 0.14) { el.style.opacity = "0"; continue; }
        el.style.left = `${x * cx + cx}ch`;
        el.style.top = `${(-y * cy + cy) * LH}em`;
        el.style.opacity = "";
      }
    };

    let phi = -1.1, raf = 0, last = 0;
    const draw = (p: number) => { drawBase(p); drawLines(p); drawMarkers(p); };
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
      <pre ref={lineRef} className="ascii-base ascii-lines" style={{ lineHeight: LH }} />
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
