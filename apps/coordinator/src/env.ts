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
});

export const env = EnvSchema.parse(process.env);
export const isProd = process.env.NODE_ENV === "production";
