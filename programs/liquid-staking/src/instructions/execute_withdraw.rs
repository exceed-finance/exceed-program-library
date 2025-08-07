use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::{error::StakingError, state::*};

#[event]
pub struct ExecuteWithdrawEvent {
    pub withdrawal_fee: u64,
    pub input_amount: u64,
    pub output_amount: u64,
    pub sol_usdc_price: i64,
    pub price_exponent: i32,
    pub price_publish_time: i64,
}

#[derive(Accounts)]
pub struct ExecuteWithdraw<'info> {
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
    pub pair: Box<Account<'info, Pair>>,

    #[account(
        address = pair.base_token_mint
    )]
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        address = pair.lst_mint
    )]
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
        close = staker,
        seeds = [
            b"withdrawal_request",
            withdrawal_window.key().as_ref(),
            staker.key().as_ref(),
        ],
        bump,
        constraint = withdrawal_request.window == withdrawal_window.key() @ StakingError::InvalidWithdrawalWindow,
    )]
    pub withdrawal_request: Box<Account<'info, WithdrawalRequest>>,

    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        init_if_needed,
        payer = staker,
        associated_token::mint = base_token_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_base_token_account: InterfaceAccount<'info, TokenAccount>,
    pub price_feed: Box<Account<'info, PriceUpdateV2>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExecuteWithdraw>) -> Result<()> {
    let access_control = &ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    let current_timestamp = Clock::get()?.unix_timestamp;
    let withdrawal_window = &ctx.accounts.withdrawal_window;
    let is_funded = withdrawal_window.is_funded;
    let earliest_withdrawal_time = withdrawal_window.earliest_withdrawal_time;
    let pair_key = withdrawal_window.pair;
    let start_time = withdrawal_window.start_time;
    let start_time_bytes = start_time.to_le_bytes();

    // Verify window is finalized and funded
    require!(is_funded, StakingError::WindowNotFunded);

    // Verify earliest withdrawal time has been reached and not expired
    require!(
        current_timestamp >= earliest_withdrawal_time,
        StakingError::WithdrawalTooEarly
    );
    require!(
        current_timestamp <= withdrawal_window.expiration_time,
        StakingError::WithdrawalExpired
    );

    let withdrawal_amount = ctx.accounts.withdrawal_request.base_amount;

    // Prepare seeds
    let window_seed_prefix = b"withdrawal_window";

    let window_seeds = [
        window_seed_prefix.as_ref(),
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
        ctx.accounts.withdrawal_request.lst_amount,
    )?;

    // Update withdrawal window withdrawn amount
    let withdrawal_window = &mut ctx.accounts.withdrawal_window;
    withdrawal_window.withdrawn_amount = withdrawal_window
        .withdrawn_amount
        .checked_add(withdrawal_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    let withdrawal_request = &ctx.accounts.withdrawal_request;

    withdrawal_window.total_lst_burned = withdrawal_window
        .total_lst_burned
        .checked_add(withdrawal_request.lst_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    // Transfer base tokens from window account to staker
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

    let clock = Clock::get()?;
    let price = ctx.accounts.price_feed.get_price_no_older_than(
        &clock,
        100,
        &ctx.accounts.access_control.sol_usdc_feed_id,
    )?;

    emit!(ExecuteWithdrawEvent {
        withdrawal_fee: withdrawal_request.lst_fee_amount,
        input_amount: withdrawal_request.lst_amount,
        output_amount: withdrawal_request.base_amount,
        sol_usdc_price: price.price,
        price_exponent: price.exponent,
        price_publish_time: price.publish_time
    });

    Ok(())
}
