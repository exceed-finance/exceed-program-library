use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{error::StakingError, state::*};

#[derive(Accounts)]
pub struct RestakeExpiredWithdraw<'info> {
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(
        seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            lst_mint.key().as_ref()

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
        constraint = withdrawal_window.pair == pair.key() @ StakingError::InvalidSymbol,
    )]
    pub withdrawal_window: Box<Account<'info, WithdrawalWindow>>,

    #[account(
        mut,
        close = rent_receiver,
        seeds = [
            b"withdrawal_request",
            withdrawal_window.key().as_ref(),
            withdrawal_request.staker.as_ref(),
        ],
        bump,
        constraint = withdrawal_request.window == withdrawal_window.key() @ StakingError::InvalidWithdrawalWindow,
    )]
    pub withdrawal_request: Box<Account<'info, WithdrawalRequest>>,

    #[account(mut)]
    pub rent_receiver: SystemAccount<'info>,

    #[account(
        mut,
        address = access_control.window_authority
    )]
    pub window_authority: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = pair.lst_mint,
        associated_token::authority = withdrawal_request.staker,
        associated_token::token_program = token_program
    )]
    pub staker_lst_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pair.base_token_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program
    )]
    pub pair_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pair.base_token_mint,
        associated_token::authority = withdrawal_window,
        associated_token::token_program = token_program
    )]
    pub window_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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
        mint::authority = lst_mint,
    )]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<RestakeExpiredWithdraw>) -> Result<()> {
    let access_control = &ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    let current_timestamp = Clock::get()?.unix_timestamp;
    require!(
        current_timestamp > ctx.accounts.withdrawal_window.expiration_time,
        StakingError::WithdrawalNotExpired
    );

    // Get LST amount from withdrawal request before it's closed
    let lst_amount = ctx.accounts.withdrawal_request.lst_amount;

    // Update withdrawal window withdrawn amount
    let withdrawal_window = &mut ctx.accounts.withdrawal_window;
    withdrawal_window.withdrawn_amount = withdrawal_window
        .withdrawn_amount
        .checked_add(ctx.accounts.withdrawal_request.base_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    let pair_key = ctx.accounts.pair.key();
    let window_start_time_bytes = ctx.accounts.withdrawal_window.start_time.to_le_bytes();
    let window_signer_seeds: &[&[&[u8]]] = &[&[
        b"withdrawal_window",
        pair_key.as_ref(),
        window_start_time_bytes.as_ref(),
        &[ctx.accounts.withdrawal_window.bump],
    ]];

    // Transfer LST back to staker.
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.window_lst_account.to_account_info(),
                mint: ctx.accounts.lst_mint.to_account_info(),
                to: ctx.accounts.staker_lst_token_account.to_account_info(),
                authority: ctx.accounts.withdrawal_window.to_account_info(),
            },
            window_signer_seeds,
        ),
        lst_amount,
        ctx.accounts.lst_mint.decimals,
    )?;

    // Transfer tokens from window token account back to pair token account
    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.window_base_token_account.to_account_info(),
                to: ctx.accounts.pair_base_token_account.to_account_info(),
                authority: ctx.accounts.withdrawal_window.to_account_info(),
            },
            window_signer_seeds,
        ),
        ctx.accounts.withdrawal_request.base_amount,
    )?;

    Ok(())
}
