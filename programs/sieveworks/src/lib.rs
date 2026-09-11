//! Sieveworks Anchor program.
//!
//! Three responsibilities, mapping to spec §9:
//!   1. FindRecord — permanent, unforgeable on-chain attribution of a discovery
//!      to whoever found it. This is the "why blockchain" of the whole product.
//!   2. JobEscrow  — a funder locks a budget; the coordinator authorizes payouts
//!      per verified chunk via monotonic claim vouchers.
//!   3. WorkerStake — a bond a worker posts before paid work; detected cheating
//!      slashes it, making cheating negative expected value.
//!
//! Trust model: the COORDINATOR is a fixed authority pubkey stored on each job.
//! Instructions that encode a verification decision (record_find, claim, slash)
//! require the coordinator's signature — the chain trusts the coordinator's
//! off-chain verification pipeline, and the coordinator's decisions are all
//! independently re-verifiable via its audit endpoint. The FUNDER is a separate
//! authority that can only add/reclaim their own budget, never authorize payouts.
//!
//! NOT DEPLOYED. Program id below is a placeholder replaced at first build.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("BPxLuXppjSMehhkibfRU646ZsrMMReFkMUKjmPuirWnf");

// Unstake cooldown in slots (~0.4s/slot on Solana → ~1 hour). A worker can't
// stake, grab paid work, then instantly pull the bond before an audit lands.
const UNSTAKE_COOLDOWN_SLOTS: u64 = 9_000;

/// Generations per bucket in the training modules (Spec 03/03b). One bucket is
/// the atomic transition `advance_bucket`. Used to advance the lineage's
/// generation counter on confirm.
const BUCKET_GENERATIONS: u64 = 32;
/// Solana's incinerator — lamports sent here are burned by the runtime.
const INCINERATOR: Pubkey = pubkey!("1nc1nerator11111111111111111111111111111111");

/// The coordinator's on-chain authority. A worker's bond is GLOBAL (one
/// WorkerStake PDA per worker, not tied to any job), so unlike `slash`/`close_job`
/// there is no JobEscrow to carry the coordinator pubkey via `has_one`. We bind
/// `unstake` to this fixed key instead: the coordinator must co-sign a
/// withdrawal, and it refuses to co-sign (off-chain) while the worker holds a
/// live lease or open challenge — so a caught cheat can no longer pull the bond
/// out from under a pending slash. Rotating this key requires a program upgrade.
const COORDINATOR_AUTHORITY: Pubkey = pubkey!("5FBPoodnH48YbYeLEcahFjxXWWhiX5nUJ8yJry4aMKhE");

#[program]
pub mod sieveworks {
    use super::*;

    /// Funder opens a job and deposits its budget into the escrow PDA.
    pub fn initialize_job(
        ctx: Context<InitializeJob>,
        job_id: [u8; 16], // our DB job UUID, raw bytes — fits a PDA seed (≤32B)
        budget: u64,
        price_per_chunk: u64,
        coordinator: Pubkey,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.job_escrow;
        escrow.job_id = job_id;
        escrow.funder = ctx.accounts.funder.key();
        escrow.coordinator = coordinator; // the only key that can authorize payouts
        escrow.price_per_chunk = price_per_chunk;
        escrow.budget = budget;
        escrow.total_paid = 0;
        escrow.bump = ctx.bumps.job_escrow;

        // Move the budget from funder → escrow via the System Program. A CPI
        // transfer needs the funder's signature, which we have (funder signs
        // the tx). The escrow PDA can receive lamports even though it's
        // program-owned — a transfer only moves lamports, never touches owner.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: escrow.to_account_info(),
                },
            ),
            budget,
        )?;
        Ok(())
    }

    /// Coordinator records a verified discovery. Idempotent by construction:
    /// the FindRecord PDA is seeded by (job_id, seed), so a second call for the
    /// same find hits `init` on an existing account and fails — the coordinator
    /// treats that as "already attributed." This is the attribution primitive.
    pub fn record_find(
        ctx: Context<RecordFind>,
        _job_id: [u8; 16],
        seed: u64,
        score: i64,
        finder: Pubkey,
    ) -> Result<()> {
        // Only the job's own coordinator may attribute finds for it. Enforced
        // in the account constraints (has_one = coordinator); this is the belt
        // to that suspenders — a find is meaningless without a real verifier.
        let find = &mut ctx.accounts.find_record;
        find.job = ctx.accounts.job_escrow.key();
        find.seed = seed;
        find.score = score;
        find.finder = finder;
        find.slot = Clock::get()?.slot; // priority timestamp — who found it first
        find.bump = ctx.bumps.find_record;
        emit!(FindRecorded { job: find.job, seed, score, finder, slot: find.slot });
        Ok(())
    }

    /// Worker posts (or tops up) a bond. init_if_needed so the first stake
    /// creates the account and later stakes add to it.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.worker_stake;
        stake.worker = ctx.accounts.worker.key();
        stake.amount = stake.amount.checked_add(amount).ok_or(SieveError::Overflow)?;
        stake.state = StakeState::Active as u8;
        stake.staked_at_slot = Clock::get()?.slot;
        stake.bump = ctx.bumps.worker_stake;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.worker.to_account_info(),
                    to: stake.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Worker withdraws their bond after the cooldown. The escrow PDA is
    /// program-owned, so we can't use a System transfer out — we move lamports
    /// directly by adjusting both accounts' balances (only the program that
    /// owns the account may debit it this way).
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let stake = &mut ctx.accounts.worker_stake;
        require!(stake.state == StakeState::Active as u8, SieveError::StakeNotActive);
        let now = Clock::get()?.slot;
        require!(
            now.saturating_sub(stake.staked_at_slot) >= UNSTAKE_COOLDOWN_SLOTS,
            SieveError::CooldownActive
        );
        let amount = stake.amount;
        stake.amount = 0;
        stake.state = StakeState::Withdrawn as u8;

        **stake.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.worker.to_account_info().try_borrow_mut_lamports()? += amount;
        Ok(())
    }

    /// Worker claims earnings via a coordinator-authorized voucher.
    ///
    /// The anti-replay design (spec §9): the voucher carries the worker's
    /// CUMULATIVE lifetime earnings on this job, not a per-claim delta. The
    /// program pays `cumulative - already_paid` and stores the new cumulative.
    /// Re-submitting an old voucher pays `old_cumulative - already_paid ≤ 0`,
    /// so replay is a no-op by arithmetic — no nonce bookkeeping can be forgotten.
    /// The coordinator co-signs, which IS its authorization of the amount.
    pub fn claim(
        ctx: Context<Claim>,
        _job_id: [u8; 16],
        cumulative_amount: u64,
        nonce: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.job_escrow;
        let earn = &mut ctx.accounts.earnings;
        if earn.worker == Pubkey::default() {
            earn.worker = ctx.accounts.worker.key();
            earn.job = escrow.key();
            earn.bump = ctx.bumps.earnings;
        }
        // Cumulative must only ever grow; nonce strictly increases as a second
        // guard and an audit breadcrumb.
        require!(cumulative_amount >= earn.claimed, SieveError::NonMonotonicClaim);
        require!(nonce > earn.last_nonce, SieveError::StaleVoucher);
        let delta = cumulative_amount - earn.claimed;

        // Never pay out more than the funded budget minus what's already paid.
        require!(
            escrow.total_paid.checked_add(delta).ok_or(SieveError::Overflow)? <= escrow.budget,
            SieveError::BudgetExhausted
        );
        // The escrow must keep enough lamports to stay rent-exempt after paying.
        let rent = Rent::get()?.minimum_balance(escrow.to_account_info().data_len());
        let escrow_lamports = escrow.to_account_info().lamports();
        require!(escrow_lamports.saturating_sub(delta) >= rent, SieveError::InsufficientEscrow);

        earn.claimed = cumulative_amount;
        earn.last_nonce = nonce;
        escrow.total_paid = escrow.total_paid.checked_add(delta).ok_or(SieveError::Overflow)?;

        **escrow.to_account_info().try_borrow_mut_lamports()? -= delta;
        **ctx.accounts.worker.to_account_info().try_borrow_mut_lamports()? += delta;
        Ok(())
    }

    /// Coordinator slashes a cheating worker's bond. The slashed lamports are
    /// BURNED to Solana's incinerator (see the inline comment below) — never to
    /// the coordinator, the funder, or other contributors. Burning is the only
    /// deterrent that is un-gameable by a Sybil and gives the coordinator no
    /// incentive to slash honest workers.
    pub fn slash(ctx: Context<Slash>, _job_id: [u8; 16], amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.worker_stake;
        let slash_amount = amount.min(stake.amount);
        stake.amount -= slash_amount;
        stake.state = StakeState::Slashed as u8;

        // BURN, don't redistribute. Slashed lamports go to Solana's incinerator
        // — nobody receives them. If they flowed to the coordinator it would
        // gain an incentive to slash honestly; if they flowed to the funder or
        // to other contributors, a Sybil could slash one identity and reclaim
        // the funds through another. Destroying the value is the only
        // un-gameable deterrent. (Verifiable on-chain: slashed → incinerator.)
        **stake.to_account_info().try_borrow_mut_lamports()? -= slash_amount;
        **ctx.accounts.incinerator.try_borrow_mut_lamports()? += slash_amount;
        emit!(WorkerSlashed { worker: stake.worker, amount: slash_amount });
        Ok(())
    }

    /// Funder closes the job and reclaims all unspent lamports. Anchor's
    /// `close = funder` sends the account's entire balance (rent + leftover
    /// budget) to the funder and zeroes the account.
    pub fn close_job(_ctx: Context<CloseJob>, _job_id: [u8; 16]) -> Result<()> {
        Ok(())
    }

    // ---- training fraud-proof scaffold (Spec 03b, Tier 1) ------------------

    /// Coordinator initializes a training lineage's on-chain origin anchor.
    /// `origin_digest` = digest(init_state(lineage_seed)) — the root of the
    /// lineage hash chain. Called once per lineage at job funding.
    pub fn init_lineage(
        ctx: Context<InitLineage>,
        job_id: [u8; 16],
        lineage_idx: u32,
        origin_digest: [u8; 16],
    ) -> Result<()> {
        let lin = &mut ctx.accounts.lineage;
        lin.job_id = job_id;
        lin.lineage_idx = lineage_idx;
        lin.coordinator = ctx.accounts.coordinator.key();
        lin.confirmed_state_digest = origin_digest;
        lin.generations_confirmed = 0;
        lin.bump = ctx.bumps.lineage;
        Ok(())
    }

    /// A worker asserts a completed training chunk. THE ORIGIN ANCHOR is
    /// enforced here: `d_start` must equal the lineage's confirmed digest and
    /// `gen_start` must equal its confirmed generation count — so a chunk can
    /// only ever claim to continue the real, confirmed chain (no forged
    /// origin). The coordinator co-signs (it validated the commitment
    /// off-chain). The chunk enters Unconfirmed; `confirm_chunk` cannot run
    /// until the challenge window elapses, giving the coordinator/crowd time to
    /// re-run and `reject_chunk` a fabrication before it becomes an origin.
    pub fn assert_chunk(
        ctx: Context<AssertChunk>,
        job_id: [u8; 16],
        lineage_idx: u32,
        gen_start: u64,
        merkle_root: [u8; 32],
        d_start: [u8; 16],
        d_end: [u8; 16],
        n_buckets: u16,
        window_slots: u64,
    ) -> Result<()> {
        let lin = &ctx.accounts.lineage;
        require!(lin.confirmed_state_digest == d_start, SieveError::OriginMismatch);
        require!(lin.generations_confirmed == gen_start, SieveError::LineageGenMismatch);
        let a = &mut ctx.accounts.assertion;
        a.job_id = job_id;
        a.lineage_idx = lineage_idx;
        a.gen_start = gen_start;
        a.asserter = ctx.accounts.worker.key();
        a.coordinator = ctx.accounts.coordinator.key();
        a.merkle_root = merkle_root;
        a.d_start = d_start;
        a.d_end = d_end;
        a.n_buckets = n_buckets;
        a.opened_slot = Clock::get()?.slot;
        a.window_slots = window_slots;
        a.status = 0; // Unconfirmed
        a.bump = ctx.bumps.assertion;
        Ok(())
    }

    /// After the challenge window elapses with no rejection, the coordinator
    /// confirms the chunk: the lineage origin advances to `d_end` and the
    /// generation counter moves forward. This is the window-gated finality that
    /// turns detection into prevention — an unconfirmed (possibly poisoned)
    /// state can never seed the next chunk.
    pub fn confirm_chunk(
        ctx: Context<ConfirmChunk>,
        _job_id: [u8; 16],
        _lineage_idx: u32,
        _gen_start: u64,
    ) -> Result<()> {
        let a = &mut ctx.accounts.assertion;
        require!(a.status == 0, SieveError::AssertionNotOpen);
        let now = Clock::get()?.slot;
        require!(
            now.saturating_sub(a.opened_slot) >= a.window_slots,
            SieveError::WindowNotElapsed
        );
        let lin = &mut ctx.accounts.lineage;
        // Re-check the anchor: guards against a lineage advanced by another path
        // between assert and confirm.
        require!(lin.confirmed_state_digest == a.d_start, SieveError::OriginMismatch);
        lin.confirmed_state_digest = a.d_end;
        lin.generations_confirmed = lin
            .generations_confirmed
            .checked_add((a.n_buckets as u64).checked_mul(BUCKET_GENERATIONS).ok_or(SieveError::Overflow)?)
            .ok_or(SieveError::Overflow)?;
        a.status = 1; // Confirmed
        emit!(ChunkConfirmed {
            job_id: a.job_id,
            lineage_idx: a.lineage_idx,
            gen_start: a.gen_start,
            d_end: a.d_end,
        });
        Ok(())
    }

    /// The coordinator rejects a chunk it proved fabricated, recording the
    /// divergent transition on-chain as a PUBLIC, re-computable fraud
    /// transcript (`bad_index`, the provided start-state digest, and the true
    /// vs committed end digest). The lineage does NOT advance, so the poison
    /// never becomes an origin. Slashing the asserter's global bond is a
    /// separate `slash()` call — this is a proven cheat.
    /// (Tier 2 replaces the coordinator's word here with an on-chain one-step
    /// executor / bisection; the transcript format is forward-compatible.)
    pub fn reject_chunk(
        ctx: Context<RejectChunk>,
        _job_id: [u8; 16],
        _lineage_idx: u32,
        _gen_start: u64,
        bad_index: u16,
        provided_start_digest: [u8; 16],
        claimed_true_digest: [u8; 16],
    ) -> Result<()> {
        let a = &mut ctx.accounts.assertion;
        require!(a.status == 0, SieveError::AssertionNotOpen);
        a.status = 2; // Rejected
        emit!(ChunkRejected {
            job_id: a.job_id,
            lineage_idx: a.lineage_idx,
            gen_start: a.gen_start,
            asserter: a.asserter,
            bad_index,
            provided_start_digest,
            claimed_true_digest,
            committed_end: a.d_end,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct InitializeJob<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(
        init,
        payer = funder,
        space = 8 + JobEscrow::INIT_SPACE,
        // PDA address is a pure function of job_id, so anyone can derive the
        // escrow for a job without a lookup, and a job_id can only ever have
        // one escrow.
        seeds = [b"job", job_id.as_ref()],
        bump
    )]
    pub job_escrow: Account<'info, JobEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16], seed: u64)]
pub struct RecordFind<'info> {
    #[account(mut)]
    pub coordinator: Signer<'info>,
    #[account(
        seeds = [b"job", job_id.as_ref()],
        bump = job_escrow.bump,
        // has_one ties this call to the job's registered coordinator: the
        // signer above must equal job_escrow.coordinator, or the tx fails.
        has_one = coordinator
    )]
    pub job_escrow: Account<'info, JobEscrow>,
    #[account(
        init,
        payer = coordinator,
        space = 8 + FindRecord::INIT_SPACE,
        // Seeded by (job, seed): exactly one record per discovery, and a repeat
        // record_find for the same seed fails at init — that's the idempotency.
        seeds = [b"find", job_id.as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub find_record: Account<'info, FindRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,
    #[account(
        init_if_needed,
        payer = worker,
        space = 8 + WorkerStake::INIT_SPACE,
        // One stake account per worker pubkey — the worker's identity is the seed.
        seeds = [b"stake", worker.key().as_ref()],
        bump
    )]
    pub worker_stake: Account<'info, WorkerStake>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,
    // The coordinator MUST co-sign a withdrawal (address-bound to the fixed
    // authority, since a global bond has no escrow to carry the pubkey). This
    // is the unstake-lock: the coordinator only co-signs when its books show
    // the worker has no outstanding lease or open challenge, so the bond can't
    // be withdrawn ahead of a slash. The cooldown below remains as a backstop.
    #[account(address = COORDINATOR_AUTHORITY)]
    pub coordinator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"stake", worker.key().as_ref()],
        bump = worker_stake.bump,
        // The worker withdrawing must own this stake — the seed already binds
        // it, has_one makes the intent explicit and double-checks.
        has_one = worker
    )]
    pub worker_stake: Account<'info, WorkerStake>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct Claim<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,
    // Coordinator co-signs — this signature IS the payout authorization.
    pub coordinator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"job", job_id.as_ref()],
        bump = job_escrow.bump,
        has_one = coordinator
    )]
    pub job_escrow: Account<'info, JobEscrow>,
    #[account(
        init_if_needed,
        payer = worker,
        space = 8 + Earnings::INIT_SPACE,
        // Per (job, worker): the running claimed total that makes replay a no-op.
        seeds = [b"earn", job_id.as_ref(), worker.key().as_ref()],
        bump
    )]
    pub earnings: Account<'info, Earnings>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct Slash<'info> {
    pub coordinator: Signer<'info>,
    // Only for the coordinator-authority check: each escrow was initialized
    // with the coordinator's pubkey, so has_one proves the signer is it. The
    // escrow receives nothing now (slashed funds are burned).
    #[account(
        seeds = [b"job", job_id.as_ref()],
        bump = job_escrow.bump,
        has_one = coordinator
    )]
    pub job_escrow: Account<'info, JobEscrow>,
    #[account(mut)]
    pub worker_stake: Account<'info, WorkerStake>,
    /// Solana's incinerator: lamports credited here are burned. Constrained
    /// to the canonical address so nothing else can receive a slash.
    #[account(mut, address = INCINERATOR)]
    pub incinerator: SystemAccount<'info>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct CloseJob<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    // The coordinator must CO-SIGN a close (mirroring Slash). Without this,
    // "has_one = funder" alone lets a prize funder sweep the escrow the
    // moment a worker is about to clear the threshold — the chain has no
    // notion of deadlines or pending winners, so the party that does (the
    // coordinator) must approve the reclaim. Funder-only closing returns
    // as a timelocked path once deadlines live on-chain.
    pub coordinator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"job", job_id.as_ref()],
        bump = job_escrow.bump,
        // Only the original funder reclaims, and close returns every lamport.
        has_one = funder,
        has_one = coordinator,
        close = funder
    )]
    pub job_escrow: Account<'info, JobEscrow>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16], lineage_idx: u32)]
pub struct InitLineage<'info> {
    #[account(mut, address = COORDINATOR_AUTHORITY)]
    pub coordinator: Signer<'info>,
    #[account(
        init,
        payer = coordinator,
        space = 8 + TrainingLineage::INIT_SPACE,
        seeds = [b"lin", job_id.as_ref(), &lineage_idx.to_le_bytes()],
        bump
    )]
    pub lineage: Account<'info, TrainingLineage>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16], lineage_idx: u32, gen_start: u64)]
pub struct AssertChunk<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,
    #[account(address = COORDINATOR_AUTHORITY)]
    pub coordinator: Signer<'info>,
    #[account(
        seeds = [b"lin", job_id.as_ref(), &lineage_idx.to_le_bytes()],
        bump = lineage.bump
    )]
    pub lineage: Account<'info, TrainingLineage>,
    #[account(
        init,
        payer = worker,
        space = 8 + ChunkAssertion::INIT_SPACE,
        seeds = [b"assert", job_id.as_ref(), &lineage_idx.to_le_bytes(), &gen_start.to_le_bytes()],
        bump
    )]
    pub assertion: Account<'info, ChunkAssertion>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16], lineage_idx: u32, gen_start: u64)]
pub struct ConfirmChunk<'info> {
    #[account(address = COORDINATOR_AUTHORITY)]
    pub coordinator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"lin", job_id.as_ref(), &lineage_idx.to_le_bytes()],
        bump = lineage.bump
    )]
    pub lineage: Account<'info, TrainingLineage>,
    #[account(
        mut,
        seeds = [b"assert", job_id.as_ref(), &lineage_idx.to_le_bytes(), &gen_start.to_le_bytes()],
        bump = assertion.bump
    )]
    pub assertion: Account<'info, ChunkAssertion>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16], lineage_idx: u32, gen_start: u64)]
pub struct RejectChunk<'info> {
    #[account(address = COORDINATOR_AUTHORITY)]
    pub coordinator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"assert", job_id.as_ref(), &lineage_idx.to_le_bytes(), &gen_start.to_le_bytes()],
        bump = assertion.bump
    )]
    pub assertion: Account<'info, ChunkAssertion>,
}

// ---------------------------------------------------------------------------
// State  (InitSpace derives on-chain byte sizes so account space is exact)
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct JobEscrow {
    pub job_id: [u8; 16],
    pub funder: Pubkey,
    pub coordinator: Pubkey,
    pub price_per_chunk: u64,
    pub budget: u64,
    pub total_paid: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct FindRecord {
    pub job: Pubkey,
    pub seed: u64,
    pub score: i64,
    pub finder: Pubkey,
    pub slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct WorkerStake {
    pub worker: Pubkey,
    pub amount: u64,
    pub state: u8,
    pub staked_at_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Earnings {
    pub job: Pubkey,
    pub worker: Pubkey,
    pub claimed: u64,
    pub last_nonce: u64,
    pub bump: u8,
}

/// A training lineage's on-chain origin anchor (Spec 03b). The lineage is a
/// hash chain: `confirmed_state_digest` starts at digest(init_state) and
/// advances by one confirmed chunk at a time. A worker cannot assert a chunk
/// whose start does not match this digest — that is the anti-poisoning root.
#[account]
#[derive(InitSpace)]
pub struct TrainingLineage {
    pub job_id: [u8; 16],
    pub lineage_idx: u32,
    pub coordinator: Pubkey,
    pub confirmed_state_digest: [u8; 16],
    pub generations_confirmed: u64,
    pub bump: u8,
}

/// An asserted-but-not-yet-final training chunk. Holds the commitment
/// (`merkle_root`), the claimed endpoints (`d_start`/`d_end`), and the
/// challenge window. status: 0 Unconfirmed, 1 Confirmed, 2 Rejected.
#[account]
#[derive(InitSpace)]
pub struct ChunkAssertion {
    pub job_id: [u8; 16],
    pub lineage_idx: u32,
    pub gen_start: u64,
    pub asserter: Pubkey,
    pub coordinator: Pubkey,
    pub merkle_root: [u8; 32],
    pub d_start: [u8; 16],
    pub d_end: [u8; 16],
    pub n_buckets: u16,
    pub opened_slot: u64,
    pub window_slots: u64,
    pub status: u8,
    pub bump: u8,
}

#[repr(u8)]
pub enum StakeState {
    Active = 0,
    Cooldown = 1,
    Withdrawn = 2,
    Slashed = 3,
}

#[event]
pub struct FindRecorded {
    pub job: Pubkey,
    pub seed: u64,
    pub score: i64,
    pub finder: Pubkey,
    pub slot: u64,
}

#[event]
pub struct WorkerSlashed {
    pub worker: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ChunkConfirmed {
    pub job_id: [u8; 16],
    pub lineage_idx: u32,
    pub gen_start: u64,
    pub d_end: [u8; 16],
}

#[event]
pub struct ChunkRejected {
    pub job_id: [u8; 16],
    pub lineage_idx: u32,
    pub gen_start: u64,
    pub asserter: Pubkey,
    pub bad_index: u16,
    pub provided_start_digest: [u8; 16],
    pub claimed_true_digest: [u8; 16],
    pub committed_end: [u8; 16],
}

#[error_code]
pub enum SieveError {
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("claim must be monotonic in cumulative amount")]
    NonMonotonicClaim,
    #[msg("voucher nonce is stale")]
    StaleVoucher,
    #[msg("job budget exhausted")]
    BudgetExhausted,
    #[msg("escrow would drop below rent-exempt minimum")]
    InsufficientEscrow,
    #[msg("stake is not active")]
    StakeNotActive,
    #[msg("unstake cooldown still active")]
    CooldownActive,
    #[msg("chunk start digest does not match the lineage's confirmed origin")]
    OriginMismatch,
    #[msg("chunk gen_start does not match the lineage's confirmed generations")]
    LineageGenMismatch,
    #[msg("assertion is not in the Unconfirmed state")]
    AssertionNotOpen,
    #[msg("challenge window has not elapsed")]
    WindowNotElapsed,
}
