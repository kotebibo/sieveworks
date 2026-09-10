-- Prize (result-bounty) mode — CWF Spec 02. Orthogonal to verification
-- modes: a prize job pays the best verified CANDIDATE above a threshold by
-- a deadline, submitted openly (no chunks/leases), verified by one
-- deterministic re-evaluation, settled through the existing escrow+voucher
-- machinery (winner's earnings set in one shot; claim flow unchanged).

alter table jobs add column bounty_kind text not null default 'coverage'
  check (bounty_kind in ('coverage','prize','training'));
alter table jobs add column prize_lamports bigint;
alter table jobs add column threshold_score bigint;
alter table jobs add column deadline_at timestamptz;
alter table jobs add column prize_winner_id uuid references users(id);
alter table jobs add column prize_awarded_at timestamptz;

-- Module capability, derived from the artifact's exports at registration.
alter table worker_specs add column supports_candidates boolean not null default false;

create table candidate_submissions (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id),
  worker_id     uuid not null references users(id),
  candidate     bytea not null,
  claimed_score bigint not null,
  verified_score bigint,
  state         text not null default 'pending'
                check (state in ('pending','verified','rejected')),
  signature     text not null,
  submitted_at  timestamptz not null default now(),
  verified_at   timestamptz
);
create index candidate_submissions_job_score_idx
  on candidate_submissions (job_id, verified_score desc nulls last);

-- RLS with NO read policy (repo convention for sensitive tables): candidate
-- BYTES stay dark until the job closes — anti-sniping depends on it. Reads
-- go through coordinator endpoints, which serve scores (not bytes) while
-- the job is open. (Adversarial-review finding: without this the genome
-- bytes would be readable via PostgREST before close.)
alter table candidate_submissions enable row level security;
