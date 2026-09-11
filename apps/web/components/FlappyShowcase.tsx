"use client";

import { useEffect, useRef, useState } from "react";
import { SieveWorkerModule } from "@sieveworks/wasm-runtime";

/**
 * Live "AI learns to fly" showcase. Loads the flappy neuroevolution module and
 * runs the genetic algorithm right here in the browser — the same
 * init_state → advance_bucket loop a paid training worker runs — then animates
 * the WHOLE generation: all 64 birds of the current population fly at once,
 * graded red (struggling) → green (champion), so you watch the flock spread and
 * improve generation over generation. A living demo carrying the color
 * (brand.md), and proof the platform is more than search. Fully self-contained.
 */

const COORD = process.env.NEXT_PUBLIC_COORDINATOR_URL ?? "https://sieveworks-coordinator.fly.dev";
// The TRAINING flappy module (mode: training — exports init_state/advance_bucket/
// best_of_state). NOT the prize/candidate build (c30dd09d), which has no init_state.
const HASH = "af4a0f4faab545ef3e1bc80017c01638e79f4b81fea26424cac66519b5704e35";

// Course/world + state-layout constants — identical to the module + train replay.
const WORLD_H = 480, PIPE_SPACING = 220, PIPE_W = 52, PIPE_GAP = 150, PIPE_SPEED = 3, FIRST_PIPE_X = 400, BIRD_X = 120;
const GENOME_LEN = 130, EVO_HDR = 168, EVO_POP = 64;
const GENS_PER_BUCKET = 8;   // small → gradual, watchable improvement
const MAX_STEPS = 70;        // stop evolving after this; keep replaying the champion generation
const PARAMS = JSON.stringify({ max_ticks: 3000, gens_per_bucket: GENS_PER_BUCKET });

type Bird = { dv: DataView; nTicks: number; pipes: number };
type Flock = { gen: number; birds: Bird[]; nPipes: number; maxPipes: number; bestPipes: number };

export function FlappyShowcase() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shownRef = useRef<Flock | null>(null);    // currently animating
  const pendingRef = useRef<Flock | null>(null);   // newest, promoted at flight end
  const tickRef = useRef(0);
  const [gen, setGen] = useState(0);
  const [pipes, setPipes] = useState(0);
  const [status, setStatus] = useState("loading the flock…");

  // Evolve on the main thread, throttled — one small bucket every ~0.9s.
  useEffect(() => {
    let cancelled = false;
    let mod: SieveWorkerModule | null = null;
    let state: Uint8Array;
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const traceFlock = (m: SieveWorkerModule, s: Uint8Array, generation: number): Flock => {
      const birds: Bird[] = [];
      let maxPipes = 0, bestPipes = 0, nPipes = 64;
      for (let i = 0; i < EVO_POP; i++) {
        const genome = s.subarray(EVO_HDR + i * GENOME_LEN, EVO_HDR + (i + 1) * GENOME_LEN);
        const trace = m.traceCandidate(genome, PARAMS);
        const dv = new DataView(trace.buffer, trace.byteOffset, trace.byteLength);
        const nTicks = dv.getUint32(0, true);
        const p = dv.getUint32(4, true);
        nPipes = dv.getUint32(8, true);
        birds.push({ dv, nTicks, pipes: p });
        if (p > maxPipes) maxPipes = p;
        if (p > bestPipes) bestPipes = p;
      }
      return { gen: generation, birds, nPipes, maxPipes: Math.max(1, maxPipes), bestPipes };
    };

    (async () => {
      try {
        const bytes = await (await fetch(`${COORD}/v1/specs/${HASH}/artifact`)).arrayBuffer();
        if (cancelled) return;
        mod = await SieveWorkerModule.load(new Uint8Array(bytes), HASH);
        state = mod.initState(crypto.getRandomValues(new Uint8Array(32)), PARAMS);
        setStatus("evolving");
        const tick = () => {
          if (cancelled || !mod) return;
          state = mod.advanceBucket(state, PARAMS);
          step++;
          pendingRef.current = traceFlock(mod, state, step * GENS_PER_BUCKET);
          if (step < MAX_STEPS) timer = setTimeout(tick, 900);
          else setStatus("champions");
        };
        timer = setTimeout(tick, 300);
      } catch {
        setStatus("demo unavailable — see the /train page");
      }
    })();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  // Fit the canvas to its container (crisp on HiDPI).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth, h = Math.round(parent.clientWidth * 0.36);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Animate the whole flock; promote a newer generation only at flight end so a
  // generation always plays edge-to-edge (a lesson from the demo videos).
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.width / dpr, H = canvas.height / dpr;

      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#C4E3FA");
      sky.addColorStop(1, "#9DCEF2");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      let rep = shownRef.current;
      if (!rep && pendingRef.current) {
        shownRef.current = pendingRef.current; tickRef.current = 0; rep = shownRef.current;
        setGen(rep.gen); setPipes(rep.bestPipes);
      }
      if (!rep) {
        ctx.fillStyle = "#3A5A78"; ctx.font = "13px system-ui, sans-serif";
        ctx.fillText("warming up the flock…", 20, H / 2);
        return;
      }

      const longest = Math.max(1, ...rep.birds.map((b) => b.nTicks));
      if (tickRef.current >= longest + 22) {
        if (pendingRef.current && pendingRef.current !== rep) {
          shownRef.current = pendingRef.current; tickRef.current = 0; rep = shownRef.current!;
          setGen(rep.gen); setPipes(rep.bestPipes);
        } else {
          tickRef.current = 0;
        }
      }
      const t = reduce ? Math.floor(longest / 2) : Math.min(tickRef.current, longest);
      const scroll = t * PIPE_SPEED;

      // pipes (shared course — read from the first bird's trace)
      ctx.fillStyle = "#4EA362";
      const gap = (PIPE_GAP * H) / WORLD_H / 2;
      const course = rep.birds[0]?.dv;
      if (course) {
        for (let i = 0; i < rep.nPipes; i++) {
          const px = FIRST_PIPE_X + i * PIPE_SPACING - scroll;
          if (px + PIPE_W < 0 || px > W) continue;
          const gc = course.getInt32(12 + i * 4, true) * (H / WORLD_H);
          ctx.fillRect(px, 0, PIPE_W, gc - gap);
          ctx.fillRect(px, gc + gap, PIPE_W, H - gc - gap);
        }
      }

      // the flock — every bird, coloured by fitness (dim red → bright green).
      // A living bird holds screen-x = BIRD_X as the world scrolls past. A dead
      // bird stays pinned to WHERE it crashed and recedes left with the course
      // (screen-x = BIRD_X − (t − deathTick)·speed), so you see it stuck on the
      // pipe it hit rather than hovering — then it scrolls off.
      for (const b of rep.birds) {
        if (b.nTicks === 0) continue;
        const alive = t < b.nTicks;
        const shownTick = alive ? t : b.nTicks - 1;
        const x = alive ? BIRD_X : BIRD_X - (t - b.nTicks) * PIPE_SPEED;
        if (x < -8) continue; // crashed and scrolled off the left edge
        const yOff = 12 + rep.nPipes * 4 + shownTick * 4;
        if (yOff + 2 > b.dv.byteLength) continue;
        const y = b.dv.getInt16(yOff, true) * (H / WORLD_H);
        const fit = b.pipes / rep.maxPipes;
        const hue = 8 + 132 * fit;
        const light = 46 + 10 * fit;
        ctx.globalAlpha = alive ? 0.45 + 0.5 * fit : 0.3;
        ctx.fillStyle = `hsl(${hue} 74% ${light}%)`;
        ctx.beginPath();
        ctx.arc(x, y, alive && fit > 0.98 ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduce) tickRef.current += 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flappy">
      <canvas ref={canvasRef} className="flappy-canvas" />
      <div className="flappy-hud">
        <span className="flappy-chip">◈ generation {gen}</span>
        <span className="flappy-chip flappy-chip-green">best cleared {pipes} pipes</span>
        <span className="flappy-status">{status}</span>
      </div>
    </div>
  );
}
