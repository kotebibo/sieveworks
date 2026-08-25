import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { BucketPool } from "./bucketPool.js";
import { env } from "./env.js";
import { createLeaseStore } from "./leases.js";
import { registry } from "./moduleRegistry.js";
import { registerRoutes } from "./routes.js";
import { startSweeper } from "./sweeper.js";

const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });
await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

// Seed the built-in worker modules into the registry, then verify one loads.
// A coordinator that can't load its own reference modules must not serve.
const builtinHashes = await registry.seedBuiltins();
app.log.info({ builtins: builtinHashes.length, hashes: builtinHashes }, "worker modules seeded");

const bucketPool = new BucketPool();
await bucketPool.start();

const { store: leases, backend } = createLeaseStore();
app.log.info({ backend }, "lease store ready");

app.get("/health", async () => ({
  ok: true,
  service: "sieveworks-coordinator",
  modules: builtinHashes.length,
  lease_backend: backend,
}));

// Live self-test: verify a seed through the Minecraft reference module.
app.get("/health/verify", async () => {
  const mod = await registry.get(builtinHashes[0]!);
  const score = mod.evaluateSeed(12345n, '{"radius":256,"scorer":"biome_diversity","version_pin":"1.21.1"}');
  return { ok: score === 7n, module: mod.specVersion(), seed: "12345", score: score.toString() };
});

registerRoutes(app, { leases, bucketPool });
startSweeper({ leases, bucketPool });

await app.listen({ port: env.PORT, host: "0.0.0.0" });
