import type { MetadataRoute } from "next";

const BASE = "https://sieveworks.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/how-it-works", "/bounties", "/contribute", "/finds", "/leaderboard", "/docs"];
  return routes.map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: path === "" || path === "/bounties" ? "hourly" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
