use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{error::StakingError, state::*};

#[event]
pub struct ForceWithdrawalEvent {
    pub staker: Pubkey,
    pub pair: Pubkey,
    pub lst_amount: u64,
    pub base_amount: u64,
}

#[derive(Accounts)]
pub struct ForceWithdrawal<'info> {
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(
        seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            pair.lst_mint.key().as_ref()
        ],
        bump = pair.pair_bump
    )]
    pub pair: Box<Account<'info, Pair>>,

    #[account(address = pair.base_token_mint)]
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = pair.lst_mint)]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,

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
        mut,
        associated_token::mint = base_token_mint,
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
        close = vault_authority,
        seeds = [
            b"withdrawal_request",
            withdrawal_window.key().as_ref(),
            staker.key().as_ref(),
        ],
        bump,
        constraint = withdrawal_request.window == withdrawal_window.key() @ StakingError::InvalidWithdrawalWindow,
    )]
    pub withdrawal_request: Box<Account<'info, WithdrawalRequest>>,

    /// CHECK: The staker whose withdrawal is being forced. Not a signer.
    pub staker: UncheckedAccount<'info>,

    #[account(
        mut,
        address = access_control.vault_authority
    )]
    pub vault_authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = vault_authority,
        associated_token::mint = base_token_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_base_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ForceWithdrawal>) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    let withdrawal_window = &ctx.accounts.withdrawal_window;

    // Window must be funded
    require!(withdrawal_window.is_funded, StakingError::WindowNotFunded);

    // Must be within withdrawal time range
    let current_timestamp = Clock::get()?.unix_timestamp;
    require!(
        current_timestamp >= withdrawal_window.earliest_withdrawal_time,
        StakingError::WithdrawalTooEarly
    );
    require!(
        current_timestamp <= withdrawal_window.expiration_time,
        StakingError::WithdrawalExpired
    );

    let pair_key = withdrawal_window.pair;
    let start_time = withdrawal_window.start_time;
    let start_time_bytes = start_time.to_le_bytes();

    let withdrawal_amount = ctx.accounts.withdrawal_request.base_amount;
    let lst_amount = ctx.accounts.withdrawal_request.lst_amount;

    let window_seeds = [
        b"withdrawal_window".as_ref(),
        pair_key.as_ref(),
        start_time_bytes.as_ref(),
        &[ctx.bumps.withdrawal_window],
    ];
    let seeds = &[&window_seeds[..]];

    // Burn LST tokens
    anchor_spl::token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Burn {
                mint: ctx.accounts.lst_mint.to_account_info(),
                from: ctx.accounts.window_lst_account.to_account_info(),
                authority: ctx.accounts.withdrawal_window.to_account_info(),
            },
            seeds,
        ),
        lst_amount,
    )?;

    // Update window state
    let withdrawal_window = &mut ctx.accounts.withdrawal_window;
    withdrawal_window.withdrawn_amount = withdrawal_window
        .withdrawn_amount
        .checked_add(withdrawal_amount)
        .ok_or(StakingError::CalculationOverflow)?;
    withdrawal_window.total_lst_burned = withdrawal_window
        .total_lst_burned
        .checked_add(lst_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    // Transfer base tokens to staker
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.window_base_token_account.to_account_info(),
                to: ctx.accounts.staker_base_token_account.to_account_info(),
                mint: ctx.accounts.base_token_mint.to_account_info(),
                authority: ctx.accounts.withdrawal_window.to_account_info(),
            },
            seeds,
        ),
        withdrawal_amount,
        ctx.accounts.pair.base_mint_decimals as u8,
    )?;

    emit!(ForceWithdrawalEvent {
        staker: ctx.accounts.withdrawal_request.staker,
        pair: pair_key,
        lst_amount,
        base_amount: withdrawal_amount,
    });

    Ok(())
}
