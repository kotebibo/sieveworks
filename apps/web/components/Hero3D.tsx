"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Hero 3D backdrop — the product's name in motion. Candidate "seeds" pour down
 * through a sieve: most fall through and fade (unverified), a few CATCH on the
 * mesh and glow — green (verified), amber (record). The Daylight Arcade colour
 * semantics (brand.md), rendered as the literal mechanism. One instanced draw
 * call for the seeds + one line grid for the sieve; capped DPR; frozen under
 * prefers-reduced-motion; hidden on small screens; lazy + client-only so it
 * never blocks paint. Purely decorative (aria-hidden) — the live swarm data
 * still lives in the panel on top.
 */

const COUNT = 300;
const FIELD_X = 5.4, FIELD_Z = 3.0;     // horizontal spread of the pour
const TOP_Y = 4.2, BOTTOM_Y = -4.0, PLANE_Y = 0;
const HOLE = 0.55;                        // sieve grid pitch
const CAUGHT_HOLD = 2.6;                  // seconds a caught seed glows before recycling

const FALL = new THREE.Color("#8FB4DC");  // unverified, pale sky
const GREEN = new THREE.Color("#1E9E5C"); // verified
const AMBER = new THREE.Color("#E08A2B"); // record

type Seed = {
  x: number; z: number; y: number; vy: number;
  kind: 0 | 1 | 2;      // 0 fall-through · 1 catch-green · 2 catch-amber
  caught: boolean; caughtAt: number; decided: boolean;
};

function rollKind(): 0 | 1 | 2 {
  const r = Math.random();
  return r < 0.05 ? 2 : r < 0.22 ? 1 : 0;
}

function Sieve({ reduce }: { reduce: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const seeds = useMemo<Seed[]>(() => {
    const arr: Seed[] = [];
    for (let i = 0; i < COUNT; i++) {
      const kind = rollKind();
      // spread across the full height at t0 so the field starts full
      const y = BOTTOM_Y + Math.random() * (TOP_Y - BOTTOM_Y);
      arr.push({
        x: (Math.random() - 0.5) * 2 * FIELD_X,
        z: (Math.random() - 0.5) * 2 * FIELD_Z,
        y, vy: 1.3 + Math.random() * 1.4, kind,
        caught: kind !== 0 && y <= PLANE_Y && Math.random() < 0.5,
        caughtAt: 0, decided: y <= PLANE_Y,
      });
    }
    return arr;
  }, []);

  // sieve grid geometry (line segments on the y=0 plane)
  const gridGeo = useMemo(() => {
    const pts: number[] = [];
    const nx = Math.round((FIELD_X * 2) / HOLE), nz = Math.round((FIELD_Z * 2) / HOLE);
    for (let i = -nx / 2; i <= nx / 2; i++) { const x = i * HOLE; pts.push(x, 0, -FIELD_Z, x, 0, FIELD_Z); }
    for (let j = -nz / 2; j <= nz / 2; j++) { const z = j * HOLE; pts.push(-FIELD_X, 0, z, FIELD_X, 0, z); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  const respawn = (s: Seed) => {
    s.y = TOP_Y + Math.random() * 1.8;
    s.x = (Math.random() - 0.5) * 2 * FIELD_X;
    s.z = (Math.random() - 0.5) * 2 * FIELD_Z;
    s.vy = 1.3 + Math.random() * 1.4;
    s.kind = rollKind();
    s.caught = false; s.decided = false; s.caughtAt = 0;
  };

  useFrame((state, delta) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];
      if (!reduce) {
        if (!s.caught) {
          s.y -= s.vy * dt;
          if (!s.decided && s.y <= PLANE_Y) {
            s.decided = true;
            if (s.kind !== 0) { s.caught = true; s.caughtAt = t; s.y = PLANE_Y; }
          }
          if (s.y < BOTTOM_Y) respawn(s);
        } else if (t - s.caughtAt > CAUGHT_HOLD) {
          respawn(s);
        }
      }

      // position: caught seeds snap into the nearest hole on the mesh
      const px = s.caught ? Math.round(s.x / HOLE) * HOLE : s.x;
      const pz = s.caught ? Math.round(s.z / HOLE) * HOLE : s.z;
      dummy.position.set(px, s.y, pz);

      // scale: shrink to nothing near the bottom (fade), pop + gentle pulse when caught
      let sc = 0.075;
      if (s.caught) {
        const age = t - s.caughtAt;
        sc = 0.11 * (1 + 0.12 * Math.sin(t * 5 + i)) * Math.min(1, age * 6);
      } else if (s.y < PLANE_Y) {
        sc *= Math.max(0, (s.y - BOTTOM_Y) / (PLANE_Y - BOTTOM_Y));
      }
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      m.setColorAt(i, color.copy(s.caught ? (s.kind === 2 ? AMBER : GREEN) : FALL));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;

    if (group.current && !reduce) {
      const px = state.pointer.x, py = state.pointer.y;
      group.current.rotation.y += ((px * 0.18) - group.current.rotation.y) * 0.03;
      group.current.rotation.x += ((0.12 - py * 0.06) - group.current.rotation.x) * 0.03;
    }
  });

  return (
    <group ref={group} rotation={[0.12, 0, 0]}>
      <lineSegments geometry={gridGeo}>
        <lineBasicMaterial color="#2F79CE" transparent opacity={0.34} />
      </lineSegments>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FIELD_X * 2, FIELD_Z * 2]} />
        <meshBasicMaterial color="#2F79CE" transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshStandardMaterial roughness={0.35} metalness={0.05} />
      </instancedMesh>
    </group>
  );
}

export function Hero3D() {
  const [reduce, setReduce] = useState(false);
  const [ok, setOk] = useState(true);
  useEffect(() => {
    setReduce(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    if (window.innerWidth < 720) setOk(false);
  }, []);
  if (!ok) return null;

  return (
    <div aria-hidden className="hero3d-wrap">
      <Canvas
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 3.1, 7.4], fov: 44 }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[5, 8, 4]} intensity={1.0} />
        <directionalLight position={[-5, 2, -5]} intensity={0.3} color="#bcd6f2" />
        <Sieve reduce={reduce} />
      </Canvas>
      <div className="hero3d-mask" />
    </div>
  );
}
