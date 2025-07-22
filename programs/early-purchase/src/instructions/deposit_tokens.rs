use std::u64;

use anchor_lang::prelude::*;
use anchor_spl::token::{self};
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::error::EarlyPurchaseError;
use crate::state::{Guardian, Sale};

#[derive(Accounts)]
pub struct DepositTokens<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub guardian: Account<'info, Guardian>,

    #[account(mut,
              has_one = purchase_program)]
    pub sale: Account<'info, Sale>,

    #[account(mut,
              token::mint = sale.purchase_mint,
              token::authority = sale,
              token::token_program = purchase_program)]
    pub sale_purchase_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut,
              token::mint = sale.purchase_mint,
              token::authority = authority,
              token::token_program = purchase_program)]
    pub authority_purchase_ata: InterfaceAccount<'info, TokenAccount>,

    pub purchase_program: Interface<'info, TokenInterface>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DepositTokensParams {
    pub amount_to_deposit: u64,
}

pub fn handler(ctx: Context<DepositTokens>, params: DepositTokensParams) -> Result<()> {
    let sale = &mut ctx.accounts.sale;

    let authority = &ctx.accounts.authority;
    let guardian = &ctx.accounts.guardian;
    let purchase_program = &ctx.accounts.purchase_program;
    let authority_purchase_ata = &ctx.accounts.authority_purchase_ata;
    let sale_purchase_ata = &ctx.accounts.sale_purchase_ata;

    let amount_to_deposit = params.amount_to_deposit;

    require!(
        guardian.permissions.deposit_tokens,
        EarlyPurchaseError::GuardianMissingPermission
    );

    require!(sale.is_ended(), EarlyPurchaseError::DepositBeforeEnd);

    require!(
        sale.has_deposit_supply(amount_to_deposit),
        EarlyPurchaseError::TotalPurchaseCountReached
    );

    sale.process_deposit(amount_to_deposit);

    token::transfer(
        CpiContext::new(
            purchase_program.to_account_info(),
            token::Transfer {
                from: authority_purchase_ata.to_account_info(),
                to: sale_purchase_ata.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount_to_deposit,
    )?;

    Ok(())
}
