use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface},
};

use crate::{
    error::StakingError,
    state::{AccessControl, Pair},
    types::ConversionDirection,
};

#[derive(Accounts)]
pub struct SwapLst<'info> {
    // Source pair accounts
    #[account(
        mut,
        seeds = [
            b"pair",
            source_pair.base_token_mint.key().as_ref(),
            source_pair.lst_mint.key().as_ref()
        ],
        bump
    )]
    pub source_pair: Box<Account<'info, Pair>>,
    #[account(
        mut,
        address = source_pair.lst_mint
    )]
    pub source_lst_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = source_lst_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_source_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    // Destination pair accounts
    #[account(
        mut,
        seeds = [
            b"pair",
            destination_pair.base_token_mint.key().as_ref(),
            destination_pair.lst_mint.key().as_ref()
        ],
        bump,
        constraint = source_pair.base_token_mint == destination_pair.base_token_mint @ StakingError::BaseTokenMintMismatch
    )]
    pub destination_pair: Box<Account<'info, Pair>>,
    #[account(
        mut,
        address = destination_pair.lst_mint,
        mint::authority = destination_lst_mint
    )]
    pub destination_lst_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = destination_lst_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_destination_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = source_pair.lst_mint,
        associated_token::authority = source_pair,
        associated_token::token_program = token_program
    )]
    pub source_lst_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = destination_pair.lst_mint,
        associated_token::authority = destination_pair,
        associated_token::token_program = token_program
    )]
    pub destination_lst_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SwapLst>,
    amount: u64,
    merkle_proof: Option<Vec<[u8; 32]>>,
) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;
    ctx.accounts
        .access_control
        .check_whitelist_access(&ctx.accounts.user.key(), merkle_proof)?;

    // Verify merkle proof for user's address if whitelist is enabled
    let source_pair = &mut ctx.accounts.source_pair;
    let destination_pair = &mut ctx.accounts.destination_pair;
    let current_timestamp = Clock::get()?.unix_timestamp;

    if amount == 0 {
        return err!(StakingError::InvalidQuantity);
    }

    // Calculate source LST fee
    let source_lst_fee_amount = source_pair.calculate_swap_fee_lst(amount)?;
    let user_source_lst_amount = amount
        .checked_sub(source_lst_fee_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    // Calculate base token amount from source LST (after fee)
    let base_token_amount = source_pair.calculate_output_amount(
        user_source_lst_amount,
        current_timestamp,
        ConversionDirection::LstToBase,
    )?;

    // Calculate destination LST amount
    let destination_lst_amount = destination_pair.calculate_output_amount(
        base_token_amount,
        current_timestamp,
        ConversionDirection::BaseToLst,
    )?;

    // Calculate destination fee based on original amount
    let destination_lst_fee_amount =
        destination_pair.calculate_swap_fee_lst(destination_lst_amount)?;
    let user_destination_lst_amount = destination_lst_amount
        .checked_sub(destination_lst_fee_amount)
        .ok_or(StakingError::CalculationOverflow)?;

    // Check destination pair minimum and maximum deposit requirements
    destination_pair.check_minimum_deposit(base_token_amount)?;
    destination_pair.check_excessive_deposit(0, base_token_amount)?;

    // TODO: replace msg with event
    // msg!("Source LST fee amount: {}", source_lst_fee_amount);
    // msg!("Source LST user amount: {}", user_source_lst_amount);
    // msg!("Base token amount: {}", base_token_amount);
    // msg!("Destination LST fee amount: {}", destination_lst_fee_amount);
    // msg!(
    //     "Destination LST user amount: {}",
    //     user_destination_lst_amount
    // );

    // Transfer source LST fee to fee account
    if source_lst_fee_amount > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.user_source_lst_account.to_account_info(),
                    to: ctx.accounts.source_lst_fee_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.source_lst_mint.to_account_info(),
                },
            ),
            source_lst_fee_amount,
            ctx.accounts.source_lst_mint.decimals,
        )?;
    }

    // Burn source LST tokens (after fee)
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.source_lst_mint.to_account_info(),
                from: ctx.accounts.user_source_lst_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        user_source_lst_amount,
    )?;

    // Mint destination LST tokens - fee amount to fee account, remaining to user
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"lst_mint",
        destination_pair.lst_symbol.as_bytes(),
        &[destination_pair.lst_mint_bump],
    ]];

    if destination_lst_fee_amount > 0 {
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    authority: ctx.accounts.destination_lst_mint.to_account_info(),
                    to: ctx.accounts.destination_lst_fee_account.to_account_info(),
                    mint: ctx.accounts.destination_lst_mint.to_account_info(),
                },
                signer_seeds,
            ),
            destination_lst_fee_amount,
        )?;
    }

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                authority: ctx.accounts.destination_lst_mint.to_account_info(),
                to: ctx.accounts.user_destination_lst_account.to_account_info(),
                mint: ctx.accounts.destination_lst_mint.to_account_info(),
            },
            signer_seeds,
        ),
        user_destination_lst_amount,
    )?;

    Ok(())
}
