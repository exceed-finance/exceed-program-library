use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{error::StakingError, state::*};

#[derive(Accounts)]
pub struct FundWithdrawalWindow<'info> {
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            pair.lst_mint.key().as_ref()
        ],
        bump = pair.pair_bump
    )]
    pub pair: Account<'info, Pair>,

    #[account(
        mut,
        constraint = withdrawal_window.pair == pair.key(),
        constraint = !withdrawal_window.is_funded @ StakingError::WindowAlreadyFunded,
        constraint = withdrawal_window.base_token_account == window_base_token_account.key()
    )]
    pub withdrawal_window: Box<Account<'info, WithdrawalWindow>>,

    #[account(
        mut,
        address = access_control.deposit_authority
    )]
    pub deposit_authority: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = deposit_authority,
        associated_token::token_program = token_program
    )]
    pub deposit_authority_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = withdrawal_window,
        associated_token::token_program = token_program
    )]
    pub window_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        address = withdrawal_window.base_token_mint
    )]
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<FundWithdrawalWindow>) -> Result<()> {
    let access_control = &ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    let withdrawal_window = &mut ctx.accounts.withdrawal_window;
    let deposit_authority_base_token_account = &ctx.accounts.deposit_authority_base_token_account;

    // Get current timestamp
    let current_timestamp = Clock::get()?.unix_timestamp;

    // Verify window request period has ended
    require!(
        current_timestamp >= withdrawal_window.end_time,
        StakingError::WindowStillActive
    );

    // Check if signer has enough tokens to cover all withdrawals
    // Note: requested_withdrawal_amount represents the total base tokens to be distributed
    // after LST tokens were converted at their respective exchange rates during request
    require!(
        deposit_authority_base_token_account.amount
            >= withdrawal_window.requested_withdrawal_amount,
        StakingError::InsufficientFundsForWindow
    );

    // Transfer base tokens from signer to window token account
    // This amount is the sum of all converted base token amounts from withdrawal requests
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx
                    .accounts
                    .deposit_authority_base_token_account
                    .to_account_info(),
                to: ctx.accounts.window_base_token_account.to_account_info(),
                mint: ctx.accounts.base_token_mint.to_account_info(),
                authority: ctx.accounts.deposit_authority.to_account_info(),
            },
        ),
        withdrawal_window.requested_withdrawal_amount,
        ctx.accounts.base_token_mint.decimals,
    )?;

    // Mark window as funded
    withdrawal_window.is_funded = true;

    Ok(())
}
