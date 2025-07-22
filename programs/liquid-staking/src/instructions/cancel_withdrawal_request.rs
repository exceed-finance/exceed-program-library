use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{error::StakingError, state::*};

#[derive(Accounts)]
pub struct CancelWithdrawalRequest<'info> {
    #[account(
        seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            lst_mint.key().as_ref()
        ],
        bump = pair.pair_bump
    )]
    pub pair: Account<'info, Pair>,

    #[account(
        mut,
        seeds = [
            b"withdrawal_window",
            pair.key().as_ref(),
            withdrawal_window.start_time.to_le_bytes().as_ref(),
        ],
        bump,
        constraint = withdrawal_window.pair == pair.key() @ StakingError::InvalidSymbol,
    )]
    pub withdrawal_window: Account<'info, WithdrawalWindow>,

    #[account(
        mut,
        close = staker,
        seeds = [
            b"withdrawal_request",
            withdrawal_window.key().as_ref(),
            staker.key().as_ref(),
        ],
        bump,
        constraint = withdrawal_request.window == withdrawal_window.key() @ StakingError::InvalidWithdrawalWindow,
    )]
    pub withdrawal_request: Account<'info, WithdrawalRequest>,

    #[account(
        mut,
        constraint = staker.key() == withdrawal_request.staker @ StakingError::InvalidAuthority,
    )]
    pub staker: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = lst_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_lst_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = lst_mint,
        associated_token::authority = withdrawal_window,
        associated_token::token_program = token_program
    )]
    pub window_lst_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        address = pair.lst_mint,
        mint::authority = lst_mint,
    )]
    pub lst_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CancelWithdrawalRequest>) -> Result<()> {
    let access_control = &ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    let current_timestamp = Clock::get()?.unix_timestamp;

    // Get all values we need before mutable borrow
    let withdrawal_window = &ctx.accounts.withdrawal_window;
    let start_time = withdrawal_window.start_time;
    let end_time = withdrawal_window.end_time;

    // Verify window is active (cancellation only allowed during active window)
    require!(
        current_timestamp >= start_time,
        StakingError::WithdrawalCancellationNotAllowed
    );
    require!(
        current_timestamp < end_time,
        StakingError::WithdrawalCancellationNotAllowed
    );

    // Get LST amount from withdrawal request before updating
    let lst_amount = ctx.accounts.withdrawal_request.lst_amount;
    let fee_amount = ctx.accounts.withdrawal_request.lst_fee_amount;
    let base_amount = ctx.accounts.withdrawal_request.base_amount;

    // Update withdrawal window totals
    let withdrawal_window = &mut ctx.accounts.withdrawal_window;

    // Subtract the base amount from the requested withdrawal amount
    withdrawal_window.requested_withdrawal_amount = withdrawal_window
        .requested_withdrawal_amount
        .checked_sub(base_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    let pair_key = ctx.accounts.pair.key();
    let start_time_bytes = withdrawal_window.start_time.to_le_bytes();

    let window_seeds: &[&[&[u8]]] = &[&[
        b"withdrawal_window",
        pair_key.as_ref(),
        start_time_bytes.as_ref(),
        &[ctx.accounts.withdrawal_window.bump],
    ]];

    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.window_lst_account.to_account_info(),
                mint: ctx.accounts.lst_mint.to_account_info(),
                to: ctx.accounts.staker_lst_account.to_account_info(),
                authority: ctx.accounts.withdrawal_window.to_account_info(),
            },
            window_seeds,
        ),
        lst_amount + fee_amount,
        ctx.accounts.lst_mint.decimals,
    )?;

    // Account will be automatically closed and rent returned to staker
    // due to the close = staker constraint

    Ok(())
}
