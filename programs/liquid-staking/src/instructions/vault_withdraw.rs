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
#[instruction(amount: u64)]
pub struct VaultWithdraw<'info> {
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
        address = access_control.vault_authority
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Account<'info, AccessControl>,

    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program
    )]
    pub pair_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = base_token_mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program
    )]
    pub authority_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<VaultWithdraw>, amount: u64) -> Result<()> {
    let access_control = &ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    let pair_base_token_account = &ctx.accounts.pair_base_token_account;
    let authority_token_account = &ctx.accounts.authority_token_account;
    let base_token_mint = &ctx.accounts.base_token_mint;
    let pair = &ctx.accounts.pair;

    // Verify amount is not zero and not greater than vault balance
    require!(amount > 0, StakingError::InvalidQuantity);
    require!(
        amount <= pair_base_token_account.amount,
        StakingError::InvalidQuantity
    );

    // Transfer tokens from vault to authority
    let seeds = &[
        b"pair",
        pair.base_token_mint.as_ref(),
        pair.lst_mint.as_ref(),
        &[pair.pair_bump],
    ];
    let signer = &[&seeds[..]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: pair_base_token_account.to_account_info(),
                mint: base_token_mint.to_account_info(),
                to: authority_token_account.to_account_info(),
                authority: pair.to_account_info(),
            },
            signer,
        ),
        amount,
        base_token_mint.decimals,
    )?;

    Ok(())
}
