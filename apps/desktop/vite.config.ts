import { defineConfig } from "vite";

// Tauri expects a fixed dev port and no clearing of the terminal it drives.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Produce a plain static bundle in ../dist (matches tauri.conf.json frontendDist).
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
  },
});
