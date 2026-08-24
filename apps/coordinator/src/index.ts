import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./env.js";
import { createLeaseStore } from "./leases.js";
import { registerRoutes } from "./routes.js";
import { startSweeper } from "./sweeper.js";
import { loadVerifier } from "./verifier.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// The verifier loads at boot — a coordinator that can't verify must not serve.
const verifier = await loadVerifier();
app.log.info(
  { worker_spec_hash: verifier.specHash, spec_version: verifier.specVersion() },
  "verifier loaded"
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

registerRoutes(app, { leases, verifier });
startSweeper(leases);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
