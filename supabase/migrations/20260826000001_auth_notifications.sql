-- Wallet-native auth (Sign-In With Solana) + optional email for notifications.
-- Identity is the wallet (users.wallet_address already unique); auth just
-- proves control of it via a signed nonce. Email is an OPTIONAL contact
-- channel, independent of login.

alter table users add column email text;
alter table users add column notify_prefs jsonb not null default '{"records":true,"verified":false,"bounty_complete":true}';

-- Who uploaded a worker module (the authenticated wallet). Null for built-ins
-- and pre-auth uploads.
alter table worker_specs add column publisher text;

-- Short-lived one-time nonces for the sign-in challenge.
create table auth_nonces (
  wallet     text primary key,
  nonce      text not null,
  expires_at timestamptz not null
);

-- Notification records, one per event per recipient wallet. Email delivery is
-- layered on top (a sender reads unsent rows); the row exists regardless so
-- there's an in-app feed too.
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  wallet     text not null,
  kind       text not null,          -- record_found | bounty_complete | verified | module_registered
  title      text not null,
  body       text,
  link       text,
  read       boolean not null default false,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_wallet_idx on notifications (wallet, created_at desc);

-- RLS: auth_nonces and notifications are coordinator-only (served via API).
alter table auth_nonces enable row level security;
alter table notifications enable row level security;
