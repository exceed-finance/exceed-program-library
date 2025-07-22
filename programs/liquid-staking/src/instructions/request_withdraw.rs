use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{
    error::StakingError,
    state::{AccessControl, Pair, WithdrawalRequest, WithdrawalWindow},
    types::ConversionDirection,
};

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(
        mut,
        seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            pair.lst_mint.key().as_ref()
        ],
        bump = pair.pair_bump
    )]
    pub pair: Box<Account<'info, Pair>>,

    #[account(
        mut,
        seeds = [
            b"withdrawal_window",
            pair.key().as_ref(),
            withdrawal_window.start_time.to_le_bytes().as_ref(),
        ],
        bump,
        constraint = withdrawal_window.pair == pair.key() @ StakingError::InvalidWithdrawalWindow,
    )]
    pub withdrawal_window: Box<Account<'info, WithdrawalWindow>>,

    #[account(
        init,
        payer = staker,
        space = 8 + std::mem::size_of::<WithdrawalRequest>(),
        seeds = [
            b"withdrawal_request",
            withdrawal_window.key().as_ref(),
            staker.key().as_ref(),
        ],
        bump
    )]
    pub withdrawal_request: Box<Account<'info, WithdrawalRequest>>,

    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = pair.lst_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pair.lst_mint,
        associated_token::authority = withdrawal_window,
        associated_token::token_program = token_program
    )]
    pub window_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = pair.lst_mint,
        mint::authority = lst_mint
    )]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RequestWithdraw>,
    amount: u64,
    merkle_proof: Option<Vec<[u8; 32]>>,
) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;
    ctx.accounts
        .access_control
        .check_whitelist_access(&ctx.accounts.staker.key(), merkle_proof)?;

    let current_timestamp = Clock::get()?.unix_timestamp;

    // Get all values we need before mutable borrow
    let withdrawal_window = &ctx.accounts.withdrawal_window;
    let start_time = withdrawal_window.start_time;
    let end_time = withdrawal_window.end_time;
    let requested_withdrawal_amount = withdrawal_window.requested_withdrawal_amount;

    // Verify window is active
    require!(
        current_timestamp >= start_time,
        StakingError::WindowNotActive
    );
    require!(current_timestamp < end_time, StakingError::WindowExpired);

    // Verify amount is valid
    require!(amount > 0, StakingError::InvalidQuantity);

    // Calculate LST fee first
    let lst_fee_amount = ctx.accounts.pair.calculate_withdraw_fee_lst(amount)?;
    let lst_withdraw_amount = amount
        .checked_sub(lst_fee_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    // Calculate base token amount using current exchange rate and the LST withdraw amount (after fee)
    // This converts LST tokens to base tokens using the current exchange rate
    let base_amount = ctx.accounts.pair.calculate_output_amount(
        lst_withdraw_amount,
        current_timestamp,
        ConversionDirection::LstToBase,
    )?;

    // Calculate and verify new total base amount
    // requested_withdrawal_amount tracks the total base tokens to be distributed, not LST tokens
    let new_base_total = requested_withdrawal_amount
        .checked_add(base_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    // Check against max withdrawal amount (which is in base tokens)
    // This ensures the total converted base tokens don't exceed the window's maximum
    require!(
        new_base_total <= withdrawal_window.max_withdrawal_amount,
        StakingError::WindowWithdrawalLimitExceeded
    );

    // Update withdrawal window totals
    let withdrawal_window = &mut ctx.accounts.withdrawal_window;
    withdrawal_window.requested_withdrawal_amount = new_base_total;

    // Initialize withdrawal request
    let withdrawal_request = &mut ctx.accounts.withdrawal_request;
    withdrawal_request.staker = ctx.accounts.staker.key();
    withdrawal_request.window = withdrawal_window.key();
    withdrawal_request.lst_fee_amount = lst_fee_amount;
    withdrawal_request.base_amount = base_amount;
    withdrawal_request.lst_amount = lst_withdraw_amount;
    withdrawal_request.bump = ctx.bumps.withdrawal_request;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.staker_lst_account.to_account_info(),
                mint: ctx.accounts.lst_mint.to_account_info(),
                to: ctx.accounts.window_lst_account.to_account_info(),
                authority: ctx.accounts.staker.to_account_info(),
            },
        ),
        lst_withdraw_amount + lst_fee_amount,
        ctx.accounts.lst_mint.decimals,
    )?;

    // TODO: emit event

    Ok(())
}
