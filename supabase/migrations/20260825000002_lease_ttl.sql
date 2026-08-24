-- Lease TTL is a job property: chunk duration varies by params/spec, and the
-- TTL must scale with it (short chunks shouldn't hold dead leases for long).

alter table jobs add column lease_ttl_seconds int not null default 180;
