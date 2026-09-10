-- Training (effort-mode) bounties — CWF Spec 03. A chunk is a lineage
-- segment: G generations of a deterministic in-module GA. Chunks are
-- created ROLLING (each accepted chunk spawns its successor from the
-- delivered final state), not up front, so per-chunk params must be frozen
-- at creation (the immigrant genome — challenge judging must read exactly
-- what the worker was assigned, never the live global best).

create table lineages (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id),
  idx               int not null,
  latest_state      bytea,          -- delivered end-state of the last accepted chunk
  generations_done  bigint not null default 0,
  best_score        bigint,
  best_genome       bytea,
  updated_at        timestamptz not null default now(),
  unique (job_id, idx)
);
alter table lineages enable row level security;
create policy "public read" on lineages for select using (true);
-- latest_state is served only to the active leaseholder via the coordinator
-- (route-gated); public rows expose progress numbers, and the bytea column
-- is not selected by any public endpoint.

alter table chunks add column lineage_id uuid references lineages(id);
alter table chunks add column generation_offset bigint;
alter table chunks add column params jsonb; -- frozen per-chunk (falls back to jobs.params when null)
