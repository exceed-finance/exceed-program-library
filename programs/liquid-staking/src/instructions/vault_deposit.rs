use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{error::StakingError, state::*};

#[derive(Accounts)]
pub struct VaultDeposit<'info> {
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
        mut,
        address = access_control.vault_authority
    )]
    pub vault_authority: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program
    )]
    pub vault_authority_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program
    )]
    pub pair_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = pair.base_token_mint)]
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<VaultDeposit>, amount: u64) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    require!(amount > 0, StakingError::InvalidQuantity);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_authority_base_token_account.to_account_info(),
                to: ctx.accounts.pair_base_token_account.to_account_info(),
                mint: ctx.accounts.base_token_mint.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.base_token_mint.decimals,
    )?;

    msg!("Vault deposited {} base tokens back to pair", amount);

    Ok(())
}
