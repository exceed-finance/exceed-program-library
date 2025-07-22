use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    error::StakingError,
    state::{AccessControl, Pair},
};

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
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
    pub pair: Account<'info, Pair>,

    #[account(
        address = pair.lst_mint
    )]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = lst_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program

    )]
    pub fee_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = vault_authority,
        associated_token::mint = lst_mint,
        associated_token::authority = destination_owner,
        associated_token::token_program = token_program
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub destination_owner: SystemAccount<'info>,

    #[account(
        mut,
        address = access_control.vault_authority
    )]
    pub vault_authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    // Verify sufficient balance
    require!(
        ctx.accounts.fee_account.amount >= amount,
        StakingError::InsufficientFeeBalance
    );

    // Transfer fees
    let pair_seeds = [
        b"pair",
        ctx.accounts.pair.base_token_mint.as_ref(),
        ctx.accounts.pair.lst_mint.as_ref(),
        &[ctx.accounts.pair.pair_bump],
    ];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.fee_account.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.pair.to_account_info(),
                mint: ctx.accounts.lst_mint.to_account_info(),
            },
            &[&pair_seeds[..]],
        ),
        amount,
        ctx.accounts.lst_mint.decimals,
    )?;

    Ok(())
}
