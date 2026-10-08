"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import DotGlobe from "./DotGlobe";

/**
 * Canvas host for the dotted globe. Transparent, SSR-disabled (mounted via
 * next/dynamic by BackgroundGlobe), and cheap: it stops rendering when the tab
 * is hidden and holds still under prefers-reduced-motion.
 */
export default function GlobeScene() {
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mq.removeEventListener("change", apply);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <Canvas
      style={{ width: "100%", height: "100%" }}
      frameloop={!visible || reduced ? "demand" : "always"}
      dpr={[1, 2]}
      camera={{ fov: 42, position: [0, 0, 3.8], near: 0.1, far: 10 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearAlpha(0);
        // let the browser auto-restore the context instead of leaving it dead
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault(), false);
      }}
    >
      <DotGlobe reduced={reduced} />
    </Canvas>
  );
}
