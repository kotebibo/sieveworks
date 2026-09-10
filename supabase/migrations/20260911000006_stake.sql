-- Stake enforcement (burn-on-slash). Priced bounties require the contributor
-- (their payout wallet) to hold an active on-chain bond; free bounties don't.
-- The poster may raise the floor for high-value work.
alter table jobs add column required_stake_lamports bigint not null default 0;
-- worker_stakes already exists; record the on-chain state we mirror.
alter table worker_stakes add column if not exists last_slash_sig text;
