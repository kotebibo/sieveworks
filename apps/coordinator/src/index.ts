import Fastify from "fastify";
import { loadVerifier } from "./verifier.js";

const app = Fastify({ logger: true });

// The verifier loads at boot — a coordinator that can't verify must not serve.
const verifier = await loadVerifier();
app.log.info(
  { worker_spec_hash: verifier.specHash, spec_version: verifier.specVersion() },
  "verifier loaded"
);

app.get("/health", async () => ({
  ok: true,
  service: "sieveworks-coordinator",
  worker_spec_hash: verifier.specHash,
  spec_version: verifier.specVersion(),
}));

// Live self-test: verify one seed through the same path witness checks use.
app.get("/health/verify", async () => {
  const params = '{"radius":256,"scorer":"biome_diversity","version_pin":"1.21.1"}';
  const score = verifier.evaluateSeed(12345n, params);
  return { ok: score === 7n, seed: "12345", score: score.toString() };
});

// SSE stub — heartbeats only until Day 2 wires real events.
app.get("/v1/events", (req, reply) => {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  reply.raw.write(`event: hello\ndata: {"service":"sieveworks-coordinator"}\n\n`);
  const timer = setInterval(() => {
    reply.raw.write(`event: heartbeat\ndata: {"t":"${new Date().toISOString()}"}\n\n`);
  }, 15000);
  req.raw.on("close", () => clearInterval(timer));
});

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });
