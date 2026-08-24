import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sieveworks/protocol", "@sieveworks/merkle", "@sieveworks/wasm-runtime"],
};

export default nextConfig;
