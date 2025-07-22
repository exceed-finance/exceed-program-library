use anchor_lang::prelude::*;
use anchor_spl::{
    token,
    token_interface::{TokenAccount, TokenInterface},
};

use crate::{
    error::EarlyPurchaseError,
    state::{Receipt, Sale},
};

#[derive(Accounts)]
pub struct RedeemReceipt<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            Sale::PREFIX.as_bytes(), 
            sale.id.to_le_bytes().as_ref()
        ],
        bump = sale.bump
    )]
    pub sale: Account<'info, Sale>,

    #[account(mut, has_one = buyer, has_one = sale)]
    pub receipt: Account<'info, Receipt>,

    #[account(mut,
             token::mint = sale.purchase_mint,
             token::authority = buyer,
             token::token_program = purchase_program)]
    pub buyer_purchase_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut,
             token::mint = sale.purchase_mint,
             token::authority = sale,
             token::token_program = purchase_program)]
    pub config_purchase_ata: InterfaceAccount<'info, TokenAccount>,

    pub purchase_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<RedeemReceipt>) -> Result<()> {
    let sale = &mut ctx.accounts.sale;
    let receipt = &mut ctx.accounts.receipt;
    let buyer_purchase_ata = &ctx.accounts.buyer_purchase_ata;
    let config_purchase_ata = &ctx.accounts.config_purchase_ata;
    let purchase_program = &ctx.accounts.purchase_program;

    let num_tokens_pending = receipt.calculate_pending_tokens()?;
    require!(num_tokens_pending > 0, EarlyPurchaseError::NothingToRedeem);

    let num_tokens_available = sale.calculate_available_tokens()?;
    require!(
        num_tokens_available >= num_tokens_pending,
        EarlyPurchaseError::NothingToRedeem
    );

    receipt.process_redemption();
    sale.process_redemption(num_tokens_pending);

    let sale_id_bytes = sale.id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        Sale::PREFIX.as_bytes(),
        sale_id_bytes.as_ref(),
        &[sale.bump]
    ]];

    token::transfer(
        CpiContext::new_with_signer(
            purchase_program.to_account_info(),
            token::Transfer {
                from: config_purchase_ata.to_account_info(),
                to: buyer_purchase_ata.to_account_info(),
                authority: sale.to_account_info(),
            },
            signer_seeds,
        ),
        num_tokens_pending,
    )?;

    Ok(())
}
