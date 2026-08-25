-- A contributor's browser worker signs with a local key (the only key it can
-- sign with in-page). Connecting a real wallet registers where earnings should
-- be paid when claimed. Payout is separate from signing identity.

alter table users add column payout_address text;
