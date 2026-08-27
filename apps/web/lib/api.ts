"use client";

/** Coordinator API client + SSE subscription for live pages. */

export const COORDINATOR_URL =
  process.env.NEXT_PUBLIC_COORDINATOR_URL ?? "https://sieveworks-coordinator.fly.dev";

export interface JobSummary {
  id: string;
  title: string;
  game: string;
  status: string;
  worker_spec_hash: string;
  version_pin: string;
  bucket_size: number;
  chunk_size: string;
  price_per_chunk_lamports: string;
  pending_chunks: number;
  accepted_chunks: number;
  total_chunks: number;
}

export interface GlobalStats {
  open_jobs: number;
  chunks_accepted: number;
  seeds_evaluated: string;
  contributors: number;
  chunks_in_flight: number;
  sse_clients: number;
}

export interface JobDetail {
  job: Record<string, unknown> & { id: string; title: string; params: Record<string, unknown> };
  chunk_states: Record<string, number>;
}

export interface RecentResult {
  id: string;
  extremum_score: string;
  witness_seed: string;
  merkle_root: string;
  duration_ms: number;
  verification_state: string;
  submitted_at: string;
  range_start: string;
  range_end: string;
  wallet_address: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${COORDINATOR_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export interface Find {
  id: string;
  seed: string;
  score: string;
  is_record: boolean;
  tx_signature: string | null;
  created_at: string;
  job_title: string;
  job_id: string;
  wallet_address: string;
}

export interface Leader {
  wallet_address: string;
  chunks: number;
  finds: number;
  earned_lamports: string;
}

export const fetchSwarm = () => get<{ job_id: string | null; title: string | null; cells: string }>("/v1/swarm");
export const fetchJobSwarm = (id: string) => get<{ cells: string }>(`/v1/jobs/${id}/swarm`);
export const fetchStats = () => get<GlobalStats>("/v1/stats");
export const fetchJobs = () => get<{ jobs: JobSummary[] }>("/v1/jobs");
export const fetchJob = (id: string) => get<JobDetail>(`/v1/jobs/${id}`);
export const fetchJobResults = (id: string) => get<{ results: RecentResult[] }>(`/v1/jobs/${id}/results`);
export const resultsCsvUrl = (id: string, limit: number) => `${COORDINATOR_URL}/v1/jobs/${id}/results.csv?limit=${limit}`;
export const fetchFinds = () => get<{ finds: Find[] }>("/v1/finds");
export const fetchLeaderboard = () => get<{ leaders: Leader[] }>("/v1/leaderboard");
export interface WorkerSpec {
  hash: string;
  name: string;
  description: string | null;
  spec_version: string;
  conformance: { passed?: boolean; buckets_checked?: number };
  example_params: Record<string, unknown>;
  default_range_start: string | null;
  default_range_end: string | null;
  is_builtin: boolean;
  is_private: boolean;
  mine: boolean;
  publisher: string | null;
  open_jobs: number;
}

// Optionally authed: pass the session token to include your own private modules.
export async function fetchSpecs(token?: string | null): Promise<{ specs: WorkerSpec[] }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/specs`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`/v1/specs → ${res.status}`);
  return (await res.json()) as { specs: WorkerSpec[] };
}
export const specArtifactUrl = (hash: string) => `${COORDINATOR_URL}/v1/specs/${hash}/artifact`;

// Publisher flips a module public ↔ private.
export async function setSpecVisibility(hash: string, isPrivate: boolean, token: string): Promise<{ ok: boolean; is_private?: boolean; error?: string }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/specs/${hash}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ is_private: isPrivate }),
  });
  return (await res.json()) as { ok: boolean; is_private?: boolean; error?: string };
}

export interface UploadResult {
  ok: boolean;
  hash?: string;
  spec_version?: string;
  is_private?: boolean;
  reason?: string;
}

export async function uploadSpec(form: FormData, token: string): Promise<UploadResult> {
  const res = await fetch(`${COORDINATOR_URL}/v1/specs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return (await res.json()) as UploadResult;
}

// ---- auth (Sign-In With Solana) ----
export async function authNonce(wallet: string): Promise<{ nonce: string; message: string }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/auth/nonce`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }),
  });
  if (!res.ok) throw new Error("nonce request failed");
  return (await res.json()) as { nonce: string; message: string };
}
export async function authVerify(wallet: string, message: string, signature: string): Promise<{ token: string }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, message, signature }),
  });
  if (!res.ok) throw new Error("sign-in verification failed");
  return (await res.json()) as { token: string };
}

export interface Me {
  user: { wallet_address: string; display_name: string | null; email: string | null; notify_prefs: Record<string, boolean> };
  unread: number;
}
export async function fetchMe(token: string): Promise<Me> {
  const res = await fetch(`${COORDINATOR_URL}/v1/me`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error("unauthorized");
  return (await res.json()) as Me;
}
export async function updateMe(token: string, body: { email?: string | null; notify_prefs?: Record<string, boolean> }): Promise<void> {
  await fetch(`${COORDINATOR_URL}/v1/me`, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
export interface Notification { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string }
export async function fetchNotifications(token: string): Promise<{ notifications: Notification[] }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/me/notifications`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error("unauthorized");
  return (await res.json()) as { notifications: Notification[] };
}

export interface CreateJobBody {
  title: string;
  worker_spec_hash: string;
  game?: string;
  params: Record<string, unknown>;
  search_space_start: string;
  search_space_end: string;
  seeds_per_sec?: number;
  budget_lamports?: string;
  price_per_chunk_lamports?: string;
}

export async function createJobReq(
  body: CreateJobBody,
  token: string
): Promise<{ job_id?: string; status?: string; error?: unknown }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { job_id?: string; status?: string; error?: unknown };
}

// ---- on-chain settlement (devnet) ----
export interface ChainInfo {
  enabled: boolean;
  cluster: string;
  program_id: string;
  coordinator: string | null;
}
export const fetchChainInfo = () => get<ChainInfo>("/v1/chain");

export async function notifyFunded(jobId: string, signature: string, token: string): Promise<{ ok?: boolean; status?: string; error?: string }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/jobs/${jobId}/funded`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ signature }),
  });
  return (await res.json()) as { ok?: boolean; status?: string; error?: string };
}

export interface ClaimRow {
  job_id: string;
  title: string;
  status: string;
  cumulative_lamports: string;
  claimed_lamports: string;
  last_nonce: string;
}
export async function fetchClaims(token: string): Promise<{ claims: ClaimRow[]; chain: ChainInfo }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/claims`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error("unauthorized");
  return (await res.json()) as { claims: ClaimRow[]; chain: ChainInfo };
}
export interface ClaimVoucher {
  job_id: string;
  worker: string;
  cumulative_lamports: string;
  nonce: string;
  coordinator: string | null;
  program_id: string;
  error?: string;
}
export async function fetchClaimVoucher(jobId: string, token: string): Promise<ClaimVoucher> {
  const res = await fetch(`${COORDINATOR_URL}/v1/claims/${jobId}/voucher`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  return (await res.json()) as ClaimVoucher;
}
export async function submitClaim(jobId: string, txB64: string, token: string): Promise<{ ok?: boolean; signature?: string; error?: string }> {
  const res = await fetch(`${COORDINATOR_URL}/v1/claims/${jobId}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ tx: txB64 }),
  });
  return (await res.json()) as { ok?: boolean; signature?: string; error?: string };
}

/** Solana explorer link for the configured cluster. */
export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export const fetchWorker = (wallet: string) =>
  get<{ worker: { wallet_address: string; created_at: string }; stats: Record<string, string | number>; finds: unknown[] }>(
    `/v1/workers/${wallet}`
  );

export const LAMPORTS_PER_SOL = 1_000_000_000;
export function solStr(lamports: string | number): string {
  const v = Number(lamports) / LAMPORTS_PER_SOL;
  if (v === 0) return "0";
  if (v < 0.000001) return v.toExponential(2);
  // fixed notation with trailing zeros trimmed: 0.0001, 0.002, 1.5
  return parseFloat(v.toFixed(6)).toString();
}

/** Subscribe to coordinator SSE. Returns an unsubscribe function. Fires
 * onEvent for every named event; callers re-fetch what they care about. */
export function subscribeEvents(
  onEvent: (event: string, data: unknown) => void,
  eventNames: string[] = [
    "chunk_leased",
    "chunk_submitted",
    "chunk_accepted",
    "chunk_reclaimed",
    "chunk_quarantined",
    "job_created",
  ]
): () => void {
  const source = new EventSource(`${COORDINATOR_URL}/v1/events`);
  for (const name of eventNames) {
    source.addEventListener(name, (e) => {
      try {
        onEvent(name, JSON.parse((e as MessageEvent).data));
      } catch {
        onEvent(name, null);
      }
    });
  }
  return () => source.close();
}

export function truncate(s: string, head = 4, tail = 4): string {
  if (s.length <= head + tail + 1) return s;
  return tail === 0 ? `${s.slice(0, head)}…` : `${s.slice(0, head)}…${s.slice(-tail)}`;
}
