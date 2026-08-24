import postgres from "postgres";
import { env } from "./env.js";

// Supabase transaction-mode pooler (port 6543) does not support prepared
// statements — prepare:false is mandatory, not an optimization.
export const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 10,
  idle_timeout: 30,
  connect_timeout: 15,
});
