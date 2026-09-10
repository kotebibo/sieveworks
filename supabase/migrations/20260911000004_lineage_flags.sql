-- Slow-lane re-audit (Spec 03 hardening): retroactive full-chunk replays
-- need every chunk's final state (chunk_outputs, bucket_index = buckets_count
-- marks "final state") and a flag for lineages caught diverging after
-- acceptance. No clawback exists — the flag is the honest record.
alter table lineages add column flagged boolean not null default false;
