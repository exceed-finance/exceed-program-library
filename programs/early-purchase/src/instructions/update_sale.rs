use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    error::EarlyPurchaseError,
    state::{Guardian, Sale},
};

#[derive(Accounts)]
pub struct UpdateSale<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub guardian: Account<'info, Guardian>,

    #[account(mut)]
    pub sale: Account<'info, Sale>,

    pub purchase_mint: Option<InterfaceAccount<'info, Mint>>,

    pub payment_mint: Option<InterfaceAccount<'info, Mint>>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateSaleParams {
    pub guard_purchases: Option<bool>,
    pub payment_amount: Option<u64>,
    pub max_tokens_total: Option<Option<u64>>,
    pub max_tokens_per_user: Option<Option<u64>>,
    pub start_timestamp: Option<Option<i64>>,
    pub end_timestamp: Option<Option<i64>>,
    pub max_price_feed_age: Option<u64>,
}

pub fn handler(ctx: Context<UpdateSale>, params: UpdateSaleParams) -> Result<()> {
    let sale = &mut ctx.accounts.sale;

    let guardian = &ctx.accounts.guardian;
    let purchase_mint_opt = &ctx.accounts.purchase_mint;
    let payment_mint_opt = &ctx.accounts.payment_mint;

    let timestamp = Clock::get()?.unix_timestamp;
    require!(
        !sale.is_start_time_reached(timestamp),
        EarlyPurchaseError::UpdateAfterStart
    );

    require!(
        guardian.permissions.update_sale,
        EarlyPurchaseError::GuardianMissingPermission
    );

    // Mint accounts are already validated by Anchor's account validation system
    // If they can be deserialized as Mint structs, they are valid

    // Validate sale parameters for update
    sale.validate_update(
        params.payment_amount,
        params.max_tokens_total,
        params.max_tokens_per_user,
        params.start_timestamp,
        params.end_timestamp,
    )?;

    if let Some(purchase_mint) = purchase_mint_opt {
        let purchase_mint_info = purchase_mint.to_account_info();
        sale.purchase_mint = purchase_mint_info.key();
        sale.purchase_program = *purchase_mint_info.owner;
    }

    if let Some(payment_mint) = payment_mint_opt {
        let payment_mint_info = payment_mint.to_account_info();
        sale.payment_mint = payment_mint_info.key();
        sale.payment_program = *payment_mint_info.owner;
    }

    if let Some(guard_purchases) = params.guard_purchases {
        sale.guard_purchases = guard_purchases
    }

    if let Some(payment_amount) = params.payment_amount {
        sale.payment_amount = payment_amount
    }

    if let Some(max_tokens_total_opt) = params.max_tokens_total {
        sale.max_tokens_total = max_tokens_total_opt
    }

    if let Some(max_tokens_per_user_opt) = params.max_tokens_per_user {
        sale.max_tokens_per_user = max_tokens_per_user_opt
    }

    if let Some(start_timestamp_opt) = params.start_timestamp {
        sale.start_timestamp = start_timestamp_opt
    }

    if let Some(end_timestamp_opt) = params.end_timestamp {
        sale.end_timestamp = end_timestamp_opt
    }

    if let Some(max_price_feed_age_opt) = params.max_price_feed_age {
        sale.max_price_feed_age = max_price_feed_age_opt
    }

    Ok(())
}
