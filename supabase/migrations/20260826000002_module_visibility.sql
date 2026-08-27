-- Community module registry + private modules.
-- A publisher may keep a module private (visible only to them in the registry)
-- or public (listed for the whole community to browse and fund bounties
-- against). Privacy governs DISCOVERY: a private module is hidden from the
-- public listing and its raw wasm is owner-only — until the publisher posts a
-- bounty with it, at which point contributors on that job can fetch the
-- artifact to run it (they must, to do the work). Built-ins are always public.

alter table worker_specs add column is_private boolean not null default false;

-- Fast "your modules" and "public listing" scans.
create index worker_specs_publisher_idx on worker_specs (publisher) where publisher is not null;
create index worker_specs_public_idx on worker_specs (is_private, created_at);
