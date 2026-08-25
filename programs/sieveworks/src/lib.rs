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

declare_id!("Sievew0rks111111111111111111111111111111111");

// Unstake cooldown in slots (~0.4s/slot on Solana → ~1 hour). A worker can't
// stake, grab paid work, then instantly pull the bond before an audit lands.
const UNSTAKE_COOLDOWN_SLOTS: u64 = 9_000;

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

    /// Coordinator slashes a cheating worker's bond. The slashed lamports move
    /// into the job escrow (returned to the buyer's pool) rather than to the
    /// coordinator — the coordinator must never profit from slashing, or it
    /// gains an incentive to slash honest workers.
    pub fn slash(ctx: Context<Slash>, amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.worker_stake;
        let slash_amount = amount.min(stake.amount);
        stake.amount -= slash_amount;
        stake.state = StakeState::Slashed as u8;

        **stake.to_account_info().try_borrow_mut_lamports()? -= slash_amount;
        **ctx.accounts.job_escrow.to_account_info().try_borrow_mut_lamports()? += slash_amount;
        emit!(WorkerSlashed { worker: stake.worker, amount: slash_amount });
        Ok(())
    }

    /// Funder closes the job and reclaims all unspent lamports. Anchor's
    /// `close = funder` sends the account's entire balance (rent + leftover
    /// budget) to the funder and zeroes the account.
    pub fn close_job(_ctx: Context<CloseJob>, _job_id: [u8; 16]) -> Result<()> {
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
    #[account(
        mut,
        seeds = [b"job", job_id.as_ref()],
        bump = job_escrow.bump,
        has_one = coordinator
    )]
    pub job_escrow: Account<'info, JobEscrow>,
    #[account(mut)]
    pub worker_stake: Account<'info, WorkerStake>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct CloseJob<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(
        mut,
        seeds = [b"job", job_id.as_ref()],
        bump = job_escrow.bump,
        // Only the original funder reclaims, and close returns every lamport.
        has_one = funder,
        close = funder
    )]
    pub job_escrow: Account<'info, JobEscrow>,
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
}
