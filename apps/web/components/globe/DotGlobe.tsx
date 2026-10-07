"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { isLand, MASK_W, MASK_H } from "./landmask";

/**
 * A dotted point-cloud Earth: continents are drawn as a dense cluster of accent
 * dots, the oceans as a sparse faint lattice so the body still reads as a solid
 * sphere, and a handful of contributor cities pulse in verified-green. Points on
 * the far hemisphere fall to a low alpha, which is what makes it read as 3D
 * rather than a flat ring. Slow axial spin, held still under reduced motion.
 */

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// brand colours, linear-ish rgb in 0..1
const LAND = new THREE.Color(0x2f79ce); // --accent
const OCEAN = new THREE.Color(0x9fb8d6); // faint blue-grey body
const MARKER = new THREE.Color(0x1e9e5c); // --verified

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

// exact inverse of the land-sampling math below (lat = asin(y), lon = atan2(z, x)),
// so a city marker lands on the same continent its dots were sampled from.
// Coastal cities can fall a cell offshore at the mask's resolution, so nudge a
// marker to the nearest land cell — a pin floating in open ocean reads as a bug.
function snapToLand(lat: number, lon: number): [number, number] {
  if (isLand(lat, lon)) return [lat, lon];
  const dLon = 360 / MASK_W;
  const dLat = 180 / MASK_H;
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const la = lat + dy * dLat;
        const lo = lon + dx * dLon;
        if (isLand(la, lo)) return [la, lo];
      }
    }
  }
  return [lat, lon];
}

function lonLatToVec(lat: number, lon: number, r: number): [number, number, number] {
  const la = lat * (Math.PI / 180);
  const lo = lon * (Math.PI / 180);
  return [r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), r * Math.cos(la) * Math.sin(lo)];
}

const VERT = /* glsl */ `
  attribute float aType;  // 0 ocean, 1 land, 2 marker
  attribute float aSeed;
  uniform float uTime;
  uniform float uDpr;
  uniform float uSize;
  uniform float uScale;   // canvas height in CSS px — keeps dots a few px, not huge
  varying float vType;
  varying float vFront;
  void main() {
    vType = aType;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelViewMatrix) * normalize(position));
    vFront = smoothstep(-0.2, 0.55, n.z);
    float typeSize = aType == 2.0 ? 2.2 : (aType == 1.0 ? 1.35 : 0.85);
    float pulse = aType == 2.0 ? (0.82 + 0.28 * sin(uTime * 2.1 + aSeed * 6.2831)) : 1.0;
    float perspective = uScale / max(-mv.z, 0.1);
    gl_PointSize = uSize * typeSize * pulse * uDpr * perspective * (0.58 + 0.42 * vFront);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uLand;
  uniform vec3 uOcean;
  uniform vec3 uMarker;
  varying float vType;
  varying float vFront;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float edge = smoothstep(0.5, 0.34, r);
    vec3 c = vType == 2.0 ? uMarker : (vType == 1.0 ? uLand : uOcean);
    float base = vType == 2.0 ? 1.0 : (vType == 1.0 ? 0.95 : 0.5);
    float a = base * edge * mix(0.1, 1.0, vFront);
    gl_FragColor = vec4(c, a);
  }
`;

export default function DotGlobe({ reduced }: { reduced: boolean }) {
  const spin = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const N = 11000; // sampling resolution of the sphere
    const pos: number[] = [];
    const type: number[] = [];
    const seed: number[] = [];
    // deterministic ocean thinning so the body stays sparse
    let s = 0x2545f491;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN * i;
      const x = Math.cos(theta) * rad;
      const z = Math.sin(theta) * rad;
      const lat = Math.asin(y) * (180 / Math.PI);
      const lon = Math.atan2(z, x) * (180 / Math.PI);
      const land = isLand(lat, lon);
      if (!land && rand() > 0.32) continue; // keep oceans sparse
      pos.push(x, y, z);
      type.push(land ? 1 : 0);
      seed.push(rand());
    }
    for (const [cLat, cLon] of CITIES) {
      const [lat, lon] = snapToLand(cLat, cLon);
      const [x, y, z] = lonLatToVec(lat, lon, 1.012);
      pos.push(x, y, z);
      type.push(2);
      seed.push(rand());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aType", new THREE.Float32BufferAttribute(type, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uDpr: { value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1 },
          uScale: { value: 800 },
          uSize: { value: 0.0032 },
          uLand: { value: LAND },
          uOcean: { value: OCEAN },
          uMarker: { value: MARKER },
        },
      }),
    []
  );

  // start angled so the Atlantic / Americas face front
  const init = useRef(false);
  useFrame((state, delta) => {
    const p = spin.current;
    if (!p) return;
    if (!init.current) {
      p.rotation.y = -1.1;
      init.current = true;
    }
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uScale.value = state.size.height;
    if (!reduced) p.rotation.y += Math.min(delta, 0.05) * 0.075;
  });

  return (
    // ~23.5° axial tilt on the parent, spin around that tilted axis
    <group rotation={[0.1, 0, 0.41]}>
      <points ref={spin} geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
