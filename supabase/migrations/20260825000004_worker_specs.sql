-- Worker module registry — the platform's public interface made self-serve.
-- Anyone uploads a conforming WASM module (evaluate_range / evaluate_seed /
-- spec_version); the coordinator content-hashes it, runs a conformance gate,
-- and stores the artifact so jobs can pin it by hash and the coordinator can
-- load it to verify results. This is what makes Sieveworks a platform rather
-- than a Minecraft tool.

create table worker_specs (
  hash           text primary key,            -- sha256 hex of the .wasm bytes
  name           text not null,
  description    text,
  spec_version   text not null,               -- from the module's spec_version()
  wasm           bytea not null,              -- the artifact itself
  conformance    jsonb not null default '{}', -- gate results (determinism, witness invariant, timing)
  example_params jsonb not null default '{}',
  default_range_start numeric(20,0),
  default_range_end   numeric(20,0),
  is_builtin     boolean not null default false,
  created_at     timestamptz not null default now()
);

-- RLS on, NO public policy: the registry (and especially the raw wasm bytes)
-- is served by the coordinator via /v1/specs, not read directly from the anon
-- REST API. The coordinator writes/reads through the service role.
alter table worker_specs enable row level security;

-- jobs.worker_spec_hash already references a spec by hash; add the link now
-- that a registry exists. Not a hard FK (jobs may predate the registry row).
create index if not exists jobs_spec_idx on jobs (worker_spec_hash);
