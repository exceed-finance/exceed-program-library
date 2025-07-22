use anchor_lang::prelude::*;
use anchor_lang::Result;
use anchor_spl::{
    associated_token::{create_idempotent, AssociatedToken, Create},
    token_interface::{Mint, TokenInterface},
};

use crate::{error::StakingError, state::*};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateWithdrawalWindowParams {
    pub start_time: i64,
    pub end_time: i64,
    pub earliest_withdrawal_time: i64,
    pub expiration_time: i64,
    pub max_withdrawal_amount: u64,
}

#[derive(Accounts)]
#[instruction(params: CreateWithdrawalWindowParams)]
pub struct CreateWithdrawalWindow<'info> {
    #[account(seeds = [
        b"pair",
        pair.base_token_mint.key().as_ref(),
        pair.lst_mint.key().as_ref()
    ],
    bump = pair.pair_bump
    )]
    pub pair: Box<Account<'info, Pair>>,

    #[account(
        mut,
        address = access_control.window_authority
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<WithdrawalWindow>(),
        seeds = [
            b"withdrawal_window",
            pair.key().as_ref(),
            params.start_time.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub withdrawal_window: Box<Account<'info, WithdrawalWindow>>,

    #[account(address = pair.base_token_mint)]
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = pair.lst_mint)]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: checked by the associated token program.
    #[account(mut)]
    pub window_base_token_account: UncheckedAccount<'info>,
    /// CHECK: checked by the associated token program.
    #[account(mut)]
    pub window_lst_account: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

fn create_token_accounts(ctx: &Context<CreateWithdrawalWindow>) -> Result<()> {
    let base_token_mint_info = ctx.accounts.base_token_mint.to_account_info();
    let lst_mint_info = ctx.accounts.lst_mint.to_account_info();
    // let pair_authority_info = ctx.accounts.pair_authority.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();
    let associated_token_info = ctx.accounts.associated_token_program.to_account_info();
    let system_program_info = ctx.accounts.system_program.to_account_info();
    let window_info = ctx.accounts.withdrawal_window.to_account_info();
    let window_authority_info = ctx.accounts.authority.to_account_info();

    let base_token_account_info = ctx.accounts.window_base_token_account.to_account_info();
    let lst_fee_token_account_info = ctx.accounts.window_lst_account.to_account_info();

    // create base token account
    create_idempotent(CpiContext::new(
        associated_token_info.clone(),
        Create {
            payer: window_authority_info.clone(),
            associated_token: base_token_account_info,
            authority: window_info.clone(),
            mint: base_token_mint_info,
            system_program: system_program_info.clone(),
            token_program: token_program_info.clone(),
        },
    ))?;

    // create the lst fee token account
    create_idempotent(CpiContext::new(
        associated_token_info,
        Create {
            payer: window_authority_info,
            associated_token: lst_fee_token_account_info,
            authority: window_info,
            mint: lst_mint_info,
            system_program: system_program_info,
            token_program: token_program_info,
        },
    ))?;

    Ok(())
}

pub fn handler(
    ctx: Context<CreateWithdrawalWindow>,
    params: CreateWithdrawalWindowParams,
) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    let current_timestamp = Clock::get()?.unix_timestamp;

    // Verify times are valid
    require!(
        params.end_time > params.start_time,
        StakingError::InvalidWindowTimes
    );
    require!(
        params.start_time > current_timestamp,
        StakingError::WindowTimesInPast
    );
    require!(
        params.end_time > current_timestamp,
        StakingError::WindowTimesInPast
    );
    require!(
        params.earliest_withdrawal_time >= params.end_time,
        StakingError::InvalidWithdrawalTime
    );
    require!(
        params.expiration_time > params.earliest_withdrawal_time,
        StakingError::InvalidExpirationTime
    );

    create_token_accounts(&ctx)?;

    let withdrawal_window = &mut ctx.accounts.withdrawal_window;
    withdrawal_window.pair = ctx.accounts.pair.key();
    withdrawal_window.start_time = params.start_time;
    withdrawal_window.end_time = params.end_time;
    withdrawal_window.requested_withdrawal_amount = 0; // Tracks total base tokens to be distributed
    withdrawal_window.total_lst_burned = 0; // Tracks total LST tokens burned
    withdrawal_window.earliest_withdrawal_time = params.earliest_withdrawal_time;
    withdrawal_window.base_token_mint = ctx.accounts.base_token_mint.key();
    withdrawal_window.base_token_account = ctx.accounts.window_base_token_account.key();
    withdrawal_window.is_funded = false;
    withdrawal_window.bump = ctx.bumps.withdrawal_window;
    // max_withdrawal_amount is in base tokens, not LST tokens
    // This is the maximum amount of base tokens that can be withdrawn from this window
    withdrawal_window.max_withdrawal_amount = params.max_withdrawal_amount;
    withdrawal_window.expiration_time = params.expiration_time;
    withdrawal_window.withdrawn_amount = 0; // Tracks total base tokens withdrawn

    Ok(())
}
