"use client";

import Link from "next/link";
import { Magnetic } from "@/components/Magnetic";
import { HeroFallback } from "@/components/HeroFallback";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Scroll-driven hero. One full-screen 3D "sieve" scene, sticky behind the page,
 * whose camera + state are driven by NATURAL scroll position (no scroll-hijack)
 * across four beats: pour → sieve → swarm → settle. Seeds rain through the
 * mesh; the good ones catch and glow (green verified / amber record); as you
 * descend, the mesh becomes the search space filling with verified cells.
 * Copy fades past over it. Degrades to a static hero on mobile / reduced-motion.
 * The Daylight Arcade world, in depth — the product's own mechanism as the show.
 */

const COUNT = 260;
const FIELD_X = 5.6, FIELD_Z = 3.2, TOP_Y = 4.4, BOTTOM_Y = -4.2, HOLE = 0.55, CAUGHT_HOLD = 2.4;
const FALL = new THREE.Color("#8FB4DC"), GREEN = new THREE.Color("#1E9E5C"), AMBER = new THREE.Color("#E08A2B");

const BEATS = [
  { h: "Pay strangers to compute.", p: "Fund a search; anyone runs a slice of it in a browser tab." },
  { h: "Prove they did it.", p: "Every result is re-checked, not trusted — for about 0.9% overhead, not the 200% of running it three times." },
  { h: "A browser tab is a worker.", p: "No install, no signup. Paid per verified chunk, the moment it clears." },
  { h: "Settled on Solana.", p: "Every record attributed on-chain, permanently, to whoever found it first." },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
// piecewise keyframe interpolation over progress 0..1
function key(p: number, stops: [number, number][]) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [pa, va] = stops[i], [pb, vb] = stops[i + 1];
    if (p <= pb) return lerp(va, vb, (p - pa) / (pb - pa || 1));
  }
  return stops[stops.length - 1][1];
}

type Seed = { x: number; z: number; y: number; vy: number; kind: 0 | 1 | 2; caught: boolean; caughtAt: number; decided: boolean; ox: number; oz: number };
type Pointer = { x: number; y: number; active: boolean };
const rollKind = (): 0 | 1 | 2 => { const r = Math.random(); return r < 0.05 ? 2 : r < 0.22 ? 1 : 0; };

function Scene({ progress, pointer, reduce }: { progress: { current: number }; pointer: { current: Pointer }; reduce: boolean }) {
  const seedMesh = useRef<THREE.InstancedMesh>(null);
  const cellMesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  const { camera } = useThree();

  const seeds = useMemo<Seed[]>(() =>
    Array.from({ length: COUNT }, () => {
      const kind = rollKind();
      const y = BOTTOM_Y + Math.random() * (TOP_Y - BOTTOM_Y);
      return { x: (Math.random() - 0.5) * 2 * FIELD_X, z: (Math.random() - 0.5) * 2 * FIELD_Z, y, vy: 1.3 + Math.random() * 1.4, kind, caught: kind !== 0 && y <= 0 && Math.random() < 0.5, caughtAt: 0, decided: y <= 0, ox: 0, oz: 0 };
    }), []);

  // swarm cells: a grid on the sieve plane that "verifies" (fills green) as you descend
  const cells = useMemo(() => {
    const out: { x: number; z: number; order: number }[] = [];
    const nx = Math.round((FIELD_X * 2) / HOLE), nz = Math.round((FIELD_Z * 2) / HOLE);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      out.push({ x: (i - nx / 2 + 0.5) * HOLE, z: (j - nz / 2 + 0.5) * HOLE, order: Math.random() });
    }
    out.sort((a, b) => a.order - b.order);
    return out;
  }, []);

  const gridGeo = useMemo(() => {
    const pts: number[] = [];
    const nx = Math.round((FIELD_X * 2) / HOLE), nz = Math.round((FIELD_Z * 2) / HOLE);
    for (let i = -nx / 2; i <= nx / 2; i++) pts.push(i * HOLE, 0, -FIELD_Z, i * HOLE, 0, FIELD_Z);
    for (let j = -nz / 2; j <= nz / 2; j++) pts.push(-FIELD_X, 0, j * HOLE, FIELD_X, 0, j * HOLE);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  const respawn = (s: Seed) => {
    s.y = TOP_Y + Math.random() * 1.8; s.x = (Math.random() - 0.5) * 2 * FIELD_X; s.z = (Math.random() - 0.5) * 2 * FIELD_Z;
    s.vy = 1.3 + Math.random() * 1.4; s.kind = rollKind(); s.caught = false; s.decided = false; s.caughtAt = 0; s.ox = 0; s.oz = 0;
  };

  useFrame((state, delta) => {
    const p = progress.current;
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const ptr = pointer.current;
    const aspect = (camera as THREE.PerspectiveCamera).aspect || 1;

    // camera descends through the beats, then pulls back to settle
    camera.position.set(
      key(p, [[0, 0.4], [0.5, -0.2], [1, 0.6]]),
      key(p, [[0, 3.4], [0.33, 1.5], [0.66, 2.0], [1, 3.6]]),
      key(p, [[0, 7.6], [0.33, 5.2], [0.66, 6.2], [1, 8.4]]),
    );
    camera.lookAt(0, key(p, [[0, 0.4], [1, -0.2]]), 0);

    // seeds
    const m = seedMesh.current;
    if (m) {
      for (let i = 0; i < COUNT; i++) {
        const s = seeds[i];
        if (!reduce) {
          if (!s.caught) {
            s.y -= s.vy * dt;
            if (!s.decided && s.y <= 0) { s.decided = true; if (s.kind !== 0) { s.caught = true; s.caughtAt = t; s.y = 0; } }
            if (s.y < BOTTOM_Y) respawn(s);
          } else if (t - s.caughtAt > CAUGHT_HOLD) respawn(s);
        }
        // cursor repulsion: falling seeds part around the pointer (screen-space)
        let tox = 0, toz = 0;
        if (ptr.active && !s.caught && !reduce) {
          v3.set(s.x, s.y, s.z).project(camera);
          if (v3.z < 1) {
            const dx = (v3.x - ptr.x) * aspect;
            const dy = v3.y - ptr.y;
            const d = Math.hypot(dx, dy);
            const R = 0.34;
            if (d < R) {
              const f = (1 - d / R) * 1.15;
              const inv = 1 / (d || 0.001);
              tox = (v3.x - ptr.x) * aspect * inv * f;
              toz = -(v3.y - ptr.y) * inv * f;
            }
          }
        }
        s.ox += (tox - s.ox) * 0.14;
        s.oz += (toz - s.oz) * 0.14;

        const px = (s.caught ? Math.round(s.x / HOLE) * HOLE : s.x) + s.ox;
        const pz = (s.caught ? Math.round(s.z / HOLE) * HOLE : s.z) + s.oz;
        dummy.position.set(px, s.y, pz);
        let sc = 0.075;
        if (s.caught) sc = 0.11 * (1 + 0.12 * Math.sin(t * 5 + i)) * Math.min(1, (t - s.caughtAt) * 6);
        else if (s.y < 0) sc *= Math.max(0, (s.y - BOTTOM_Y) / (0 - BOTTOM_Y));
        dummy.scale.setScalar(sc); dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, col.copy(s.caught ? (s.kind === 2 ? AMBER : GREEN) : FALL));
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // swarm-fill cells: reveal proportionally to swarm-phase progress (0.45→0.9)
    const cm = cellMesh.current;
    if (cm) {
      const reveal = Math.max(0, Math.min(1, (p - 0.45) / 0.42));
      const shown = Math.floor(reveal * cells.length);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const on = i < shown;
        dummy.position.set(c.x, 0.01, c.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(on ? HOLE * 0.82 : 0.0001);
        dummy.updateMatrix();
        cm.setMatrixAt(i, dummy.matrix);
        cm.setColorAt(i, col.copy(GREEN));
      }
      cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group rotation={[0.1, 0, 0]}>
      <lineSegments geometry={gridGeo}>
        <lineBasicMaterial color="#2F79CE" transparent opacity={0.32} />
      </lineSegments>
      <instancedMesh ref={cellMesh} args={[undefined, undefined, cells.length]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.5} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={seedMesh} args={[undefined, undefined, COUNT]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshStandardMaterial roughness={0.35} metalness={0.05} />
      </instancedMesh>
    </group>
  );
}

export function ScrollExperience() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const beatRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hintRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const pointer = useRef<Pointer>({ x: 0, y: 0, active: false });
  const [reduce, setReduce] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);

  useEffect(() => {
    setReduce(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    setMobile(window.innerWidth < 820);
    setMounted(true);
  }, []);

  // pointer in normalized device coords → the 3D seeds part around the cursor
  useEffect(() => {
    if (!mounted || reduce || mobile) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
      pointer.current.active = true;
    };
    const onLeave = () => { pointer.current.active = false; };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onLeave, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerout", onLeave); };
  }, [mounted, reduce, mobile]);

  // pause the WebGL render loop entirely once the hero scrolls out of view
  useEffect(() => {
    if (!mounted || reduce || mobile) return;
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, reduce, mobile]);

  // scroll → progress (0..1 across the tall section) + beat opacities. rAF-throttled.
  useEffect(() => {
    if (!mounted || reduce || mobile) return;
    let raf = 0;
    const onScroll = () => {
      raf = 0;
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = Math.max(0, Math.min(1, -rect.top / (span || 1)));
      progress.current = p;
      const N = BEATS.length;
      const band = 1 / N;
      const active = Math.max(0, Math.min(N - 1, Math.floor(p / band + 1e-6)));
      beatRefs.current.forEach((b, i) => {
        if (!b) return;
        const u = (p - i * band) / band; // 0..1 within this beat's slice
        const isLast = i === N - 1;
        // fade in over the first 24%, hold, fade out over the last 20% (last beat holds)
        let o: number;
        if (u < -0.04 || u > 1.12) o = 0;
        else if (u < 0.24) o = u / 0.24;
        else if (!isLast && u > 0.8) o = (1 - u) / 0.2;
        else o = 1;
        o = Math.max(0, Math.min(1, o));
        // slide: enter drifting up from +42px, exit continuing up to -42px; hold at 0
        let ty = u < 0.5 ? (1 - o) * 42 : -(1 - o) * 42;
        if (isLast && u >= 0.5) ty = 0;
        b.style.opacity = String(o);
        b.style.transform = `translateY(calc(-50% + ${ty}px))`;
      });
      dotRefs.current.forEach((d, i) => {
        if (!d) return;
        d.style.opacity = i === active ? "1" : "0.28";
        d.style.transform = `scaleX(${i === active ? 2.6 : 1})`;
      });
      if (hintRef.current) hintRef.current.style.opacity = String(Math.max(0, 1 - p / 0.04));
    };
    const tick = () => { if (!raf) raf = requestAnimationFrame(onScroll); };
    onScroll();
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", tick); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [mounted, reduce, mobile]);

  // Fallback: a clean static hero for mobile / reduced-motion / SSR-first paint.
  if (!mounted || reduce || mobile) return <HeroFallback />;

  return (
    <section ref={sectionRef} className="relative" style={{ height: "560vh" }}>
      <h1 className="sr-only">Sieveworks — verifiable distributed compute. Pay strangers to compute in a browser tab and prove they actually did it, settled on Solana.</h1>
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <Canvas
          className="absolute inset-0"
          dpr={[1, 1.75]}
          frameloop={heroVisible ? "always" : "never"}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          camera={{ position: [0.4, 3.4, 7.6], fov: 46 }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <ambientLight intensity={0.85} />
          <directionalLight position={[5, 8, 4]} intensity={1.0} />
          <directionalLight position={[-5, 2, -5]} intensity={0.3} color="#bcd6f2" />
          <Scene progress={progress} pointer={pointer} reduce={reduce} />
        </Canvas>

        {/* beats — each a distinct translucent card that slides through as you scroll */}
        <div className="absolute inset-0 mx-auto max-w-[1180px] px-5 sm:px-7">
          {BEATS.map((b, i) => (
            <div
              key={i}
              ref={(el) => { beatRefs.current[i] = el; }}
              className="absolute inset-x-5 sm:inset-x-7 top-1/2"
              style={{ opacity: i === 0 ? 1 : 0, transform: "translateY(-50%)", willChange: "opacity, transform" }}
            >
              <div
                className="inline-block max-w-[44ch] border-l-[3px] pl-5 sm:pl-7 pr-6 py-6 shadow-[0_10px_40px_-16px_rgba(15,42,74,0.35)]"
                style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--bg) 82%, transparent)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
              >
                <div className="num text-[13px] mb-3" style={{ color: "var(--accent)" }}>
                  {String(i + 1).padStart(2, "0")} <span className="text-[var(--text-faint)]">/ {String(BEATS.length).padStart(2, "0")}</span>
                </div>
                <h2 className="font-display font-extrabold leading-[1.04] tracking-[-0.035em] text-[clamp(34px,5.2vw,60px)]">
                  {b.h}
                </h2>
                <p className="mt-3.5 text-[16px] sm:text-[17px] text-[var(--text-dim)] max-w-[40ch]">{b.p}</p>
                {i === BEATS.length - 1 && (
                  <div className="mt-6 flex gap-3 flex-wrap">
                    <Magnetic><Link href="/contribute" data-cursor className="sheen inline-block font-medium text-[14px] px-5 py-[11px] text-[var(--bg)]" style={{ background: "var(--accent)" }}>Start contributing</Link></Magnetic>
                    <Magnetic><Link href="/bounties" data-cursor className="inline-block font-medium text-[14px] px-5 py-[11px] border border-[var(--border-bright)] text-[var(--text)]">Post a search</Link></Magnetic>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* beat indicator — makes the four discrete beats legible */}
          <div className="absolute right-5 sm:right-7 top-1/2 -translate-y-1/2 flex flex-col gap-2.5">
            {BEATS.map((_, i) => (
              <div
                key={i}
                ref={(el) => { dotRefs.current[i] = el; }}
                className="h-[3px] w-5 rounded-full origin-right transition-[opacity,transform] duration-300"
                style={{ background: "var(--accent)", opacity: i === 0 ? 1 : 0.28, transform: i === 0 ? "scaleX(2.6)" : "scaleX(1)" }}
              />
            ))}
          </div>

          {/* scroll hint — fades out the moment you start */}
          <div ref={hintRef} className="absolute left-1/2 -translate-x-1/2 bottom-8 barlabel text-[var(--text-faint)] animate-pulse">scroll ↓</div>
        </div>
      </div>
    </section>
  );
}
