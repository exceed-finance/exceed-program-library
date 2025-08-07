use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        mint_to, transfer_checked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
    },
};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::{
    error::StakingError,
    state::{AccessControl, Pair},
    types::ConversionDirection,
};

#[event]
pub struct StakeEvent {
    pub staking_fee: u64,
    pub input_amount: u64,
    pub output_amount: u64,
    pub sol_usdc_price: i64,
    pub price_exponent: i32,
    pub price_publish_time: i64,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(mut, seeds = [
        b"pair",
        pair.base_token_mint.key().as_ref(),
        pair.lst_mint.key().as_ref()
    ],
    bump = pair.pair_bump
    )]
    pub pair: Box<Account<'info, Pair>>,

    // Base token accounts
    #[account(
        mut,
        address = pair.base_token_mint,
    )]
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program
    )]
    pub pair_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pair.lst_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program
    )]
    pub lst_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,

    // LST token accounts
    #[account(
        mut,
        address = pair.lst_mint,
        seeds = [
            b"lst_mint",
            pair.lst_symbol.as_bytes()
        ],
        bump = pair.lst_mint_bump,
        mint::authority = lst_mint,
    )]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = staker,
        associated_token::mint = lst_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub price_feed: Box<Account<'info, PriceUpdateV2>>,

    #[account(mut)]
    pub staker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Stake>,
    quantity: u64,
    merkle_proof: Option<Vec<[u8; 32]>>,
) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;
    ctx.accounts
        .access_control
        .check_whitelist_access(&ctx.accounts.staker.key(), merkle_proof)?;

    let pair = &mut ctx.accounts.pair;
    let current_timestamp = Clock::get()?.unix_timestamp;
    let total_base_token_amount = ctx.accounts.pair_base_token_account.amount;

    pair.check_minimum_deposit(quantity)?;
    pair.check_excessive_deposit(quantity, total_base_token_amount)?;

    // Calculate LST amount to mint based on exchange rate
    let lst_amount = pair.calculate_output_amount(
        quantity,
        current_timestamp,
        ConversionDirection::BaseToLst, // converting from base to LST
    )?;

    // Calculate LST fee
    let lst_fee_amount = pair.calculate_stake_fee_lst(lst_amount)?;
    let lst_staker_amount = lst_amount
        .checked_sub(lst_fee_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    // Transfer base tokens from staker to pair's base token account
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.staker_base_token_account.to_account_info(),
                to: ctx.accounts.pair_base_token_account.to_account_info(),
                mint: ctx.accounts.base_token_mint.to_account_info(),
                authority: ctx.accounts.staker.to_account_info(),
            },
        ),
        quantity,
        pair.base_mint_decimals as u8,
    )?;

    // Mint LST tokens - fee amount to fee account, remaining to staker
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"lst_mint",
        &pair.lst_symbol.as_bytes(),
        &[pair.lst_mint_bump],
    ]];

    if lst_fee_amount > 0 {
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    authority: ctx.accounts.lst_mint.to_account_info(),
                    to: ctx.accounts.lst_fee_account.to_account_info(),
                    mint: ctx.accounts.lst_mint.to_account_info(),
                },
                signer_seeds,
            ),
            lst_fee_amount,
        )?;
    }

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                authority: ctx.accounts.lst_mint.to_account_info(),
                to: ctx.accounts.staker_lst_account.to_account_info(),
                mint: ctx.accounts.lst_mint.to_account_info(),
            },
            signer_seeds,
        ),
        lst_staker_amount,
    )?;

    let clock = Clock::get()?;

    let price = ctx.accounts.price_feed.get_price_no_older_than(
        &clock,
        100,
        &ctx.accounts.access_control.sol_usdc_feed_id,
    )?;

    emit!(StakeEvent {
        staking_fee: lst_fee_amount,
        input_amount: quantity,
        output_amount: lst_amount,
        sol_usdc_price: price.price,
        price_exponent: price.exponent,
        price_publish_time: price.publish_time
    });

    Ok(())
}
