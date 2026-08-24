-- Sieveworks initial schema.
-- u64 values are numeric(20,0); scores are bigint (i64) by protocol rule —
-- integer scores make witness comparison and Merkle hashing exact.

create extension if not exists pgcrypto;

create table users (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  display_name   text,
  created_at     timestamptz not null default now()
);

create table jobs (
  id                       uuid primary key default gen_random_uuid(),
  creator_id               uuid not null references users(id),
  title                    text not null,
  description              text,
  game                     text not null,
  worker_spec_hash         text not null,
  version_pin              text not null,
  params                   jsonb not null default '{}',
  search_space_start       numeric(20,0) not null,
  search_space_end         numeric(20,0) not null, -- exclusive
  chunk_size               bigint not null,
  bucket_size              int not null default 1024,
  budget_lamports          bigint not null,
  price_per_chunk_lamports bigint not null,
  escrow_pda               text,
  status                   text not null default 'draft'
                           check (status in ('draft','open','paused','closed')),
  current_record_score     bigint,
  current_record_seed      numeric(20,0),
  created_at               timestamptz not null default now(),
  closed_at                timestamptz,
  check (search_space_end > search_space_start)
);

create table chunks (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references jobs(id),
  range_start      numeric(20,0) not null,
  range_end        numeric(20,0) not null, -- exclusive
  state            text not null default 'pending'
                   check (state in ('pending','leased','submitted','verifying','accepted','rejected','quarantined')),
  leased_to        uuid references users(id),
  leased_at        timestamptz,
  lease_expires_at timestamptz,
  attempts         int not null default 0,
  created_at       timestamptz not null default now(),
  unique (job_id, range_start), -- duplicate chunk generation is a bug the DB must catch
  check (range_end > range_start)
);
create index chunks_job_state_idx on chunks (job_id, state, range_start);

create table results (
  id                 uuid primary key default gen_random_uuid(),
  chunk_id           uuid not null references chunks(id),
  worker_id          uuid not null references users(id),
  extremum_score     bigint not null,
  witness_seed       numeric(20,0) not null,
  merkle_root        text not null,
  buckets_count      int not null,
  seeds_evaluated    numeric(20,0) not null,
  duration_ms        bigint not null,
  signature          text not null,
  verification_state text not null default 'pending'
                     check (verification_state in ('pending','witness_ok','challenged','passed','failed')),
  submitted_at       timestamptz not null default now(),
  verified_at        timestamptz
);
create index results_chunk_idx on results (chunk_id);
create index results_worker_idx on results (worker_id, submitted_at desc);

-- Rejection detail lives in its own coordinator-only table, NOT on results.
-- A specific reason (e.g. honeypot failure) returned to workers or exposed
-- publicly would let an attacker map honeypot positions with cheap probes.
-- Workers see only "rejected"; detail is served by the internal audit path.
create table result_rejections (
  result_id  uuid primary key references results(id),
  reason     text not null
             check (reason in ('spec_hash_mismatch','bad_signature','nonce_mismatch',
                               'lease_expired','witness_failed','honeypot_failed',
                               'challenge_failed','challenge_timeout','record_reverify_failed')),
  detail     jsonb,
  created_at timestamptz not null default now()
);

create table challenges (
  id             uuid primary key default gen_random_uuid(),
  result_id      uuid not null references results(id),
  bucket_indices int[] not null,
  response       jsonb,
  passed         boolean,
  issued_at      timestamptz not null default now(),
  responded_at   timestamptz
);
create index challenges_result_idx on challenges (result_id);

create table honeypots (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references jobs(id),
  seed       numeric(20,0) not null,
  score      bigint not null,
  created_at timestamptz not null default now(),
  unique (job_id, seed)
);
create index honeypots_job_seed_idx on honeypots (job_id, seed);

create table finds (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id),
  worker_id    uuid not null references users(id),
  seed         numeric(20,0) not null,
  score        bigint not null,
  is_record    boolean not null default false,
  tx_signature text,
  attested_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (job_id, seed) -- mirrors the on-chain FindRecord PDA idempotency
);
create index finds_job_idx on finds (job_id, created_at desc);

create table worker_stakes (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references users(id),
  amount_lamports bigint not null,
  state           text not null default 'active'
                  check (state in ('active','cooldown','withdrawn','slashed')),
  stake_pda       text,
  slashed_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index worker_stakes_worker_idx on worker_stakes (worker_id, state);

create table earnings (
  id                  uuid primary key default gen_random_uuid(),
  worker_id           uuid not null references users(id),
  job_id              uuid not null references jobs(id),
  cumulative_lamports bigint not null default 0,
  last_voucher_nonce  bigint not null default 0,
  last_voucher_sig    text,
  claimed_lamports    bigint not null default 0,
  updated_at          timestamptz not null default now(),
  unique (worker_id, job_id)
);

-- ---------------------------------------------------------------------------
-- RLS. All writes go through the coordinator using the service role (which
-- bypasses RLS); no insert/update/delete policies exist anywhere.
-- Public-read tables get a bare select policy. Tables with NO policy are
-- invisible to anon/authenticated clients:
--   honeypots         — secrecy is the entire mechanism
--   result_rejections — leaks honeypot positions via rejection reasons
--   challenges        — challenge internals served only via the audit endpoint
-- ---------------------------------------------------------------------------

alter table users             enable row level security;
alter table jobs              enable row level security;
alter table chunks            enable row level security;
alter table results           enable row level security;
alter table result_rejections enable row level security;
alter table challenges        enable row level security;
alter table honeypots         enable row level security;
alter table finds             enable row level security;
alter table worker_stakes     enable row level security;
alter table earnings          enable row level security;

create policy "public read" on users         for select using (true);
create policy "public read" on jobs          for select using (true);
create policy "public read" on chunks        for select using (true);
create policy "public read" on results       for select using (true);
create policy "public read" on finds         for select using (true);
create policy "public read" on worker_stakes for select using (true);
create policy "public read" on earnings      for select using (true);
