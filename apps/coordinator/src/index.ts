import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { BucketPool } from "./bucketPool.js";
import { env } from "./env.js";
import { createLeaseStore } from "./leases.js";
import { registerRoutes } from "./routes.js";
import { startSweeper } from "./sweeper.js";
import { loadVerifier } from "./verifier.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(rateLimit, {
  max: 120, // per IP per minute; leases also implicitly limited per wallet by chunk duration
  timeWindow: "1 minute",
});

// The verifier loads at boot — a coordinator that can't verify must not serve.
// Two instances of the same hash-verified artifact: main thread (witness
// checks, honeypot generation) and the bucket thread (challenge recompute).
const verifier = await loadVerifier();
const bucketPool = new BucketPool();
const threadSpecHash = await bucketPool.start();
if (threadSpecHash !== verifier.specHash) {
  throw new Error(`verify thread loaded ${threadSpecHash}, main loaded ${verifier.specHash}`);
}
app.log.info(
  { worker_spec_hash: verifier.specHash, spec_version: verifier.specVersion() },
  "verifier loaded (main + bucket thread)"
);

const { store: leases, backend } = createLeaseStore();
app.log.info({ backend }, "lease store ready");

app.get("/health", async () => ({
  ok: true,
  service: "sieveworks-coordinator",
  worker_spec_hash: verifier.specHash,
  spec_version: verifier.specVersion(),
  lease_backend: backend,
}));

// Live self-test: verify one seed through the same path witness checks use.
app.get("/health/verify", async () => {
  const params = '{"radius":256,"scorer":"biome_diversity","version_pin":"1.21.1"}';
  const score = verifier.evaluateSeed(12345n, params);
  return { ok: score === 7n, seed: "12345", score: score.toString() };
});

registerRoutes(app, { leases, verifier, bucketPool });
startSweeper({ leases, verifier, bucketPool });

await app.listen({ port: env.PORT, host: "0.0.0.0" });
