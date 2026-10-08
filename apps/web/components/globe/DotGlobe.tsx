"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { isLand, MASK_W, MASK_H } from "./landmask";

/**
 * A dotted-Earth network globe, in the Stripe / GitHub-globe lineage: the whole
 * sphere is a uniform dot field so it reads as a solid ball, continents are the
 * same lattice drawn larger and in accent blue, contributor cities pulse in
 * verified-green, and great-circle arcs rise between them with a light running
 * along each one to suggest live traffic. Far-hemisphere points and arcs fall
 * to a low alpha for depth. Slow axial spin, held still under reduced motion.
 */

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const LAND = new THREE.Color(0x2f79ce); // --accent
const OCEAN = new THREE.Color(0x7f9cc2); // body dots
const MARKER = new THREE.Color(0x1e9e5c); // --verified
const ARC = new THREE.Color(0x5b8fd6); // resting arc
const PULSE = new THREE.Color(0x2f79ce); // travelling highlight
const GRAT = new THREE.Color(0x9fb4d4); // graticule wireframe

// contributor cities [lat, lon]
const CITIES: Record<string, [number, number]> = {
  tbilisi: [41.7, 44.8],
  sf: [37.78, -122.41],
  nyc: [40.71, -74.0],
  london: [51.51, -0.13],
  tokyo: [35.68, 139.69],
  singapore: [1.35, 103.82],
  bangalore: [12.97, 77.59],
  saopaulo: [-23.55, -46.63],
  sydney: [-33.87, 151.21],
};

// the network: who links to whom
const LINKS: [string, string][] = [
  ["tbilisi", "london"],
  ["london", "nyc"],
  ["nyc", "sf"],
  ["sf", "tokyo"],
  ["tokyo", "singapore"],
  ["singapore", "bangalore"],
  ["bangalore", "tbilisi"],
  ["nyc", "saopaulo"],
  ["singapore", "sydney"],
  ["london", "saopaulo"],
  ["tbilisi", "singapore"],
  ["sf", "sydney"],
  ["tokyo", "sydney"],
  ["bangalore", "london"],
  ["saopaulo", "sf"],
  ["nyc", "tokyo"],
  ["tbilisi", "nyc"],
  ["london", "singapore"],
];

// exact inverse of the land-sampling math (lat = asin(y), lon = atan2(z, x))
function lonLatToVec(lat: number, lon: number, r: number): THREE.Vector3 {
  const la = lat * (Math.PI / 180);
  const lo = lon * (Math.PI / 180);
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), r * Math.cos(la) * Math.sin(lo));
}

// nudge a coastal city onto the nearest land cell so its pin sits on a continent
function snapToLand(lat: number, lon: number): [number, number] {
  if (isLand(lat, lon)) return [lat, lon];
  const dLon = 360 / MASK_W;
  const dLat = 180 / MASK_H;
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isLand(lat + dy * dLat, lon + dx * dLon)) return [lat + dy * dLat, lon + dx * dLon];
      }
    }
  }
  return [lat, lon];
}

const POINT_VERT = /* glsl */ `
  attribute float aType;  // 0 ocean, 1 land, 2 marker
  attribute float aSeed;
  uniform float uTime;
  uniform float uDpr;
  uniform float uSize;
  uniform float uScale;
  varying float vType;
  varying float vFront;
  void main() {
    vType = aType;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelViewMatrix) * normalize(position));
    vFront = smoothstep(-0.2, 0.55, n.z);
    float typeSize = aType == 2.0 ? 2.4 : (aType == 1.0 ? 1.55 : 0.92);
    float pulse = aType == 2.0 ? (0.82 + 0.28 * sin(uTime * 2.1 + aSeed * 6.2831)) : 1.0;
    float perspective = uScale / max(-mv.z, 0.1);
    gl_PointSize = uSize * typeSize * pulse * uDpr * perspective * (0.58 + 0.42 * vFront);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform vec3 uLand;
  uniform vec3 uOcean;
  uniform vec3 uMarker;
  varying float vType;
  varying float vFront;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    if (length(d) > 0.5) discard;
    float edge = smoothstep(0.5, 0.34, length(d));
    vec3 c = vType == 2.0 ? uMarker : (vType == 1.0 ? uLand : uOcean);
    float base = vType == 2.0 ? 1.0 : (vType == 1.0 ? 1.0 : 0.58);
    float a = base * edge * mix(0.24, 1.0, vFront);
    gl_FragColor = vec4(c, a);
  }
`;

const ARC_VERT = /* glsl */ `
  attribute float aU;
  attribute float aPhase;
  varying float vFront;
  varying float vU;
  varying float vPhase;
  void main() {
    vU = aU;
    vPhase = aPhase;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelViewMatrix) * normalize(position));
    vFront = smoothstep(-0.1, 0.5, n.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const ARC_FRAG = /* glsl */ `
  uniform vec3 uArc;
  uniform vec3 uPulse;
  uniform float uTime;
  varying float vFront;
  varying float vU;
  varying float vPhase;
  void main() {
    float head1 = fract(uTime * 0.15 + vPhase);
    float head2 = fract(uTime * 0.15 + vPhase + 0.5);
    float d1 = abs(vU - head1); d1 = min(d1, 1.0 - d1);
    float d2 = abs(vU - head2); d2 = min(d2, 1.0 - d2);
    float pulse = max(smoothstep(0.09, 0.0, d1), smoothstep(0.09, 0.0, d2));
    vec3 c = mix(uArc, uPulse, pulse);
    float a = (0.34 + 0.66 * pulse) * mix(0.1, 1.0, vFront);
    gl_FragColor = vec4(c, a);
  }
`;

const GRAT_VERT = /* glsl */ `
  varying float vFront;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelViewMatrix) * normalize(position));
    vFront = smoothstep(-0.1, 0.5, n.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const GRAT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vFront;
  void main() {
    gl_FragColor = vec4(uColor, 0.06 + 0.22 * vFront);
  }
`;

export default function DotGlobe({ reduced }: { reduced: boolean }) {
  const spin = useRef<THREE.Group>(null);

  const { pointsGeo, pointsMat, arcGeo, arcMat, gratGeo, gratMat } = useMemo(() => {
    // ---- uniform dot field, land highlighted ----
    const N = 13000;
    const pos: number[] = [];
    const type: number[] = [];
    const seed: number[] = [];
    let s = 0x2545f491;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN * i;
      const x = Math.cos(theta) * rad;
      const z = Math.sin(theta) * rad;
      const lat = Math.asin(y) * (180 / Math.PI);
      const lon = Math.atan2(z, x) * (180 / Math.PI);
      pos.push(x, y, z);
      type.push(isLand(lat, lon) ? 1 : 0);
      seed.push(rand());
    }
    for (const [cLat, cLon] of Object.values(CITIES)) {
      const [lat, lon] = snapToLand(cLat, cLon);
      const v = lonLatToVec(lat, lon, 1.012);
      pos.push(v.x, v.y, v.z);
      type.push(2);
      seed.push(rand());
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    pg.setAttribute("aType", new THREE.Float32BufferAttribute(type, 1));
    pg.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));

    const pm = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uDpr: { value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1 },
        uScale: { value: 800 },
        uSize: { value: 0.0066 },
        uLand: { value: LAND },
        uOcean: { value: OCEAN },
        uMarker: { value: MARKER },
      },
    });

    // ---- great-circle arcs between cities ----
    const SEG = 50;
    const aPos: number[] = [];
    const aU: number[] = [];
    const aPhase: number[] = [];
    LINKS.forEach(([from, to], li) => {
      const a = lonLatToVec(...CITIES[from], 1).normalize();
      const b = lonLatToVec(...CITIES[to], 1).normalize();
      const omega = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
      const sinO = Math.sin(omega) || 1e-5;
      const lift = 0.04 + omega * 0.1; // longer hops bow out a little further
      const phase = li / LINKS.length;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= SEG; k++) {
        const t = k / SEG;
        const w1 = Math.sin((1 - t) * omega) / sinO;
        const w2 = Math.sin(t * omega) / sinO;
        const p = new THREE.Vector3(a.x * w1 + b.x * w2, a.y * w1 + b.y * w2, a.z * w1 + b.z * w2);
        p.setLength(1 + lift * Math.sin(Math.PI * t));
        pts.push(p);
      }
      for (let k = 0; k < SEG; k++) {
        const p0 = pts[k];
        const p1 = pts[k + 1];
        aPos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        aU.push(k / SEG, (k + 1) / SEG);
        aPhase.push(phase, phase);
      }
    });
    const ag = new THREE.BufferGeometry();
    ag.setAttribute("position", new THREE.Float32BufferAttribute(aPos, 3));
    ag.setAttribute("aU", new THREE.Float32BufferAttribute(aU, 1));
    ag.setAttribute("aPhase", new THREE.Float32BufferAttribute(aPhase, 1));

    const am = new THREE.ShaderMaterial({
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uArc: { value: ARC },
        uPulse: { value: PULSE },
      },
    });

    // ---- graticule wireframe: latitude rings + meridians ----
    const R = 0.998;
    const gPos: number[] = [];
    const pushSeg = (p0: number[], p1: number[]) =>
      gPos.push(p0[0] * R, p0[1] * R, p0[2] * R, p1[0] * R, p1[1] * R, p1[2] * R);
    for (const latDeg of [-60, -30, 0, 30, 60]) {
      const lat = (latDeg * Math.PI) / 180, yy = Math.sin(lat), rr = Math.cos(lat), seg = 72;
      let prev: number[] | null = null;
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * 2 * Math.PI;
        const p = [Math.cos(th) * rr, yy, Math.sin(th) * rr];
        if (prev) pushSeg(prev, p);
        prev = p;
      }
    }
    for (let d = 0; d < 360; d += 30) {
      const lon = (d * Math.PI) / 180, seg = 48;
      let prev: number[] | null = null;
      for (let i = 0; i <= seg; i++) {
        const lat = -Math.PI / 2 + (i / seg) * Math.PI, rr = Math.cos(lat), yy = Math.sin(lat);
        const p = [Math.cos(lon) * rr, yy, Math.sin(lon) * rr];
        if (prev) pushSeg(prev, p);
        prev = p;
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(gPos, 3));
    const gm = new THREE.ShaderMaterial({
      vertexShader: GRAT_VERT,
      fragmentShader: GRAT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { uColor: { value: GRAT } },
    });

    return { pointsGeo: pg, pointsMat: pm, arcGeo: ag, arcMat: am, gratGeo: gg, gratMat: gm };
  }, []);

  const init = useRef(false);
  useFrame((state, delta) => {
    const g = spin.current;
    if (!g) return;
    if (!init.current) {
      g.rotation.y = -1.1;
      init.current = true;
    }
    const t = state.clock.elapsedTime;
    pointsMat.uniforms.uTime.value = t;
    pointsMat.uniforms.uScale.value = state.size.height;
    arcMat.uniforms.uTime.value = t;
    if (!reduced) g.rotation.y += Math.min(delta, 0.05) * 0.07;
  });

  return (
    // ~axial tilt on the parent; spin the inner group so dots + arcs turn together
    <group rotation={[0.1, 0, 0.41]}>
      <group ref={spin}>
        <lineSegments geometry={gratGeo} material={gratMat} frustumCulled={false} />
        <points geometry={pointsGeo} material={pointsMat} frustumCulled={false} />
        <lineSegments geometry={arcGeo} material={arcMat} frustumCulled={false} />
      </group>
    </group>
  );
}
