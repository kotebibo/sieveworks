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

export const fetchStats = () => get<GlobalStats>("/v1/stats");
export const fetchJobs = () => get<{ jobs: JobSummary[] }>("/v1/jobs");
export const fetchJob = (id: string) => get<JobDetail>(`/v1/jobs/${id}`);
export const fetchJobResults = (id: string) => get<{ results: RecentResult[] }>(`/v1/jobs/${id}/results`);

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
