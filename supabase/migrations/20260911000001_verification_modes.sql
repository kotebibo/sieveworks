-- Verification modes (CWF Spec 01). A job's mode is copied from its module
-- at creation and immutable; the artifact's optional `verification_mode`
-- WASM export is the source of truth, the column is a query convenience.
-- Extremum columns go nullable because output_hash results have no scalar
-- score; delivered output bytes live in chunk_outputs (digest-checked
-- against the Merkle leaf commitment before storage).

alter table jobs add column verification_mode text not null default 'witness_extremum'
  check (verification_mode in ('witness_extremum','output_hash','training'));

alter table worker_specs add column verification_mode text not null default 'witness_extremum';

alter table results alter column extremum_score drop not null;
alter table results alter column witness_seed drop not null;

-- Postgres check constraints are not extendable in place: drop + re-add.
alter table chunks drop constraint chunks_state_check;
alter table chunks add constraint chunks_state_check
  check (state in ('pending','leased','submitted','verifying',
                   'awaiting_outputs','accepted','rejected','quarantined'));

alter table result_rejections drop constraint result_rejections_reason_check;
alter table result_rejections add constraint result_rejections_reason_check
  check (reason in ('spec_hash_mismatch','bad_signature','nonce_mismatch',
                    'lease_expired','witness_failed','honeypot_failed',
                    'challenge_failed','challenge_timeout','record_reverify_failed',
                    'output_digest_mismatch','output_delivery_timeout'));

-- Delivered bucket outputs (mode 2/3). Bytes are the funder's product —
-- public read is intentional (render tiles feed the public render view).
create table chunk_outputs (
  result_id    uuid not null references results(id),
  bucket_index int not null,
  bytes        bytea not null,
  created_at   timestamptz not null default now(),
  primary key (result_id, bucket_index)
);
alter table chunk_outputs enable row level security;
create policy "public read" on chunk_outputs for select using (true);
