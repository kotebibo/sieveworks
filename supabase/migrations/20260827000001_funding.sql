-- On-chain bounty funding. A priced job is created as 'draft' and opens only
-- after the funder's initialize_job lands on devnet and the coordinator
-- verifies the escrow PDA (POST /v1/jobs/:id/funded). These columns record
-- that verification. ('draft' is already in the jobs.status check constraint.)

alter table jobs add column funding_signature text;
alter table jobs add column funded_at timestamptz;
