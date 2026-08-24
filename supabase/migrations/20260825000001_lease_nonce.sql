-- Day 2: per-lease nonce. Postgres is the source of truth for lease state
-- (spec §7); the nonce issued with an assignment must round-trip on the
-- submission, so it lives on the chunk row, not only in Redis.

alter table chunks add column lease_nonce text;
