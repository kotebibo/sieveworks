-- Spec 03b: a delivered training chunk that has been asserted on-chain is
-- parked in 'awaiting_confirm' until the coordinator re-runs it within the
-- challenge window and confirms (or rejects) it. Add the state value.
-- (Flag-gated: only reachable when TRAINING_FRAUD_PROOF is on.)
alter table chunks drop constraint chunks_state_check;
alter table chunks add constraint chunks_state_check
  check (state in ('pending','leased','submitted','verifying',
                   'awaiting_outputs','awaiting_confirm','accepted','rejected','quarantined'));
