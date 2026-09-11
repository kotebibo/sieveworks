"use client";

import { useEffect, useRef, useState } from "react";
import { SieveWorkerModule } from "@sieveworks/wasm-runtime";

/**
 * Live "AI learns to fly" showcase. Loads the flappy neuroevolution module and
 * runs the genetic algorithm right here in the browser — the same
 * init_state → advance_bucket → best_of_state loop a paid training worker runs —
 * then animates the current champion flying the course. Generation counter and
 * pipes-cleared climb as it learns. A living demo carrying the color (brand.md),
 * and proof the platform is more than search: anything you can score, you can
 * evolve. Fully self-contained — no job, no coordinator round-trip beyond
 * fetching the pinned WASM artifact.
 */

const COORD = process.env.NEXT_PUBLIC_COORDINATOR_URL ?? "https://sieveworks-coordinator.fly.dev";
// The TRAINING flappy module (mode: training — exports init_state/advance_bucket/
// best_of_state). NOT the prize/candidate "learns to fly" build (c30dd09d), which
// has no init_state and would throw.
const HASH = "af4a0f4faab545ef3e1bc80017c01638e79f4b81fea26424cac66519b5704e35";

// Course/world constants — identical to the training replay so the look matches.
const WORLD_H = 480, PIPE_SPACING = 220, PIPE_W = 52, PIPE_GAP = 150, PIPE_SPEED = 3, FIRST_PIPE_X = 400, BIRD_X = 120;
const GENOME_LEN = 130;
const GENS_PER_BUCKET = 8;          // small → gradual, watchable improvement
const MAX_STEPS = 70;               // stop evolving after this; keep replaying the champion
const PARAMS = JSON.stringify({ max_ticks: 3000, gens_per_bucket: GENS_PER_BUCKET });

type Champ = { gen: number; pipes: number; dv: DataView; nTicks: number; nPipes: number };

export function FlappyShowcase() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shownRef = useRef<Champ | null>(null);   // currently animating
  const pendingRef = useRef<Champ | null>(null);  // newest, promoted at flight end
  const tickRef = useRef(0);
  const [gen, setGen] = useState(0);
  const [pipes, setPipes] = useState(0);
  const [status, setStatus] = useState("loading the flock…");

  // Evolve on the main thread, throttled (one small bucket every ~0.7s).
  useEffect(() => {
    let cancelled = false;
    let mod: SieveWorkerModule | null = null;
    let state: Uint8Array;
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

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
          const witness = mod.bestOfState(state, PARAMS);      // i64 score ‖ genome
          const genome = witness.slice(8, 8 + GENOME_LEN);
          const trace = mod.traceCandidate(genome, PARAMS);
          const dv = new DataView(trace.buffer, trace.byteOffset, trace.byteLength);
          pendingRef.current = {
            gen: step * GENS_PER_BUCKET,
            pipes: dv.getUint32(4, true),
            nTicks: dv.getUint32(0, true),
            nPipes: dv.getUint32(8, true),
            dv,
          };
          if (step < MAX_STEPS) timer = setTimeout(tick, 700);
          else setStatus("champion");
        };
        timer = setTimeout(tick, 350);
      } catch {
        setStatus("demo unavailable — try the /train page");
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

  // Animate the champion. Promote a newer champion only at flight end, so a
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
        setGen(rep.gen); setPipes(rep.pipes);
      }
      if (!rep) return;

      const longest = Math.max(1, rep.nTicks);
      if (tickRef.current >= longest + 20) {
        if (pendingRef.current && pendingRef.current !== rep) {
          shownRef.current = pendingRef.current; tickRef.current = 0; rep = shownRef.current!;
          setGen(rep.gen); setPipes(rep.pipes);
        } else {
          tickRef.current = 0;
        }
      }
      const t = reduce ? Math.floor(longest / 2) : Math.min(tickRef.current, longest);
      const scroll = t * PIPE_SPEED;

      // pipes
      ctx.fillStyle = "#4EA362";
      const gap = (PIPE_GAP * H) / WORLD_H / 2;
      for (let i = 0; i < rep.nPipes; i++) {
        const px = FIRST_PIPE_X + i * PIPE_SPACING - scroll;
        if (px + PIPE_W < 0 || px > W) continue;
        const gc = rep.dv.getInt32(12 + i * 4, true) * (H / WORLD_H);
        ctx.fillRect(px, 0, PIPE_W, gc - gap);
        ctx.fillRect(px, gc + gap, PIPE_W, H - gc - gap);
      }

      // champion bird — colour ramps red→green with pipes cleared
      const alive = t < rep.nTicks;
      const shownTick = alive ? t : rep.nTicks - 1;
      const yOff = 12 + rep.nPipes * 4 + shownTick * 4;
      if (yOff + 2 <= rep.dv.byteLength && rep.nTicks > 0) {
        const y = rep.dv.getInt16(yOff, true) * (H / WORLD_H);
        const fit = Math.min(1, rep.pipes / 8);
        ctx.globalAlpha = alive ? 1 : 0.4;
        ctx.fillStyle = `hsl(${8 + 132 * fit} 74% ${46 + 8 * fit}%)`;
        ctx.beginPath(); ctx.arc(BIRD_X, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(BIRD_X + 2.5, y - 2.5, 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
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
        <span className="flappy-chip flappy-chip-green">{pipes} pipes cleared</span>
        <span className="flappy-status">{status}</span>
      </div>
    </div>
  );
}
