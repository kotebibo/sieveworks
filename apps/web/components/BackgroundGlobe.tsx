"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";

// WebGL scene, mounted client-only so it never blocks SSR or the critical path.
const GlobeScene = dynamic(() => import("./globe/GlobeScene"), { ssr: false });

/**
 * The hero's dotted-Earth backdrop: a point-cloud globe whose continents are
 * drawn in accent dots, built on three.js / react-three-fiber. Purely
 * decorative (aria-hidden), and isolated behind an error boundary so a lost or
 * missing WebGL context fails to nothing instead of taking the page down.
 */
class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function BackgroundGlobe() {
  return (
    <div className="w-full h-full" aria-hidden>
      <GlobeBoundary>
        <GlobeScene />
      </GlobeBoundary>
    </div>
  );
}
