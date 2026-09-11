import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Local dev reads the repo-root .env.local; on Fly, real env vars exist and
// loadEnvFile never overrides them.
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env.local");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* optional */
  }
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  ADMIN_TOKEN: z.string().min(16).default("dev-admin-token-not-for-prod"),
  AUTH_SECRET: z.string().min(16).default("dev-auth-secret-not-for-prod-change-me"),
  RESEND_API_KEY: z.string().optional(),
  NOTIFY_FROM: z.string().default("Sieveworks <noreply@sieveworks.dev>"),
  WEB_URL: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().int().default(8080),
  WORKER_WASM_PATH: z.string().optional(),
  // On-chain settlement (devnet). SOLANA_COORDINATOR_KEYPAIR is the JSON array
  // form of the authority keypair (same format as solana-keygen). Unset ⇒ all
  // chain calls no-op, so local dev without a key still works end-to-end.
  SOLANA_RPC_URL: z.string().default("https://api.devnet.solana.com"),
  SOLANA_CLUSTER: z.string().default("devnet"),
  SOLANA_COORDINATOR_KEYPAIR: z.string().optional(),
  // Spec 03b fraud-proof training verification. Default OFF: training keeps its
  // probabilistic (10% + slow-lane) path untouched. ON: chunks are asserted
  // on-chain and only advance the lineage after a coordinator re-run within the
  // challenge window (window-gated finality = prevention, not just detection).
  TRAINING_FRAUD_PROOF: z.coerce.boolean().default(false),
  // Challenge window in Solana slots (~2/s on devnet). Short by design (owner:
  // coordinator-driven). 150 ≈ 60-75s — enough for the sweep to re-run + confirm.
  TRAINING_WINDOW_SLOTS: z.coerce.number().int().positive().default(150),
});

export const env = EnvSchema.parse(process.env);
export const isProd = process.env.NODE_ENV === "production";
