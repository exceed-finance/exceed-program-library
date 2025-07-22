use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use pyth_solana_receiver_sdk::price_update::get_feed_id_from_hex;

use crate::error::EarlyPurchaseError;
use crate::state::Sale;

#[derive(Accounts)]
#[instruction(params: InitializeSaleParams)]
pub struct InitializeSale<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Sale::SIZE,
        seeds = [
            Sale::PREFIX.as_bytes(), 
            params.id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub sale: Account<'info, Sale>,

    pub purchase_mint: InterfaceAccount<'info, Mint>,

    pub payment_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeSaleParams {
    pub id: u64,
    pub guard_purchases: bool,
    pub payment_amount: u64,
    pub price_feed_id_hex: String,
    pub max_price_feed_age: u64,
    pub max_tokens_total: Option<u64>,
    pub max_tokens_per_user: Option<u64>,
    pub start_timestamp: Option<i64>,
    pub end_timestamp: Option<i64>,
}

pub fn handler(ctx: Context<InitializeSale>, params: InitializeSaleParams) -> Result<()> {
    let sale = &mut ctx.accounts.sale;

    let admin = &ctx.accounts.admin;

    let purchase_mint_info = ctx.accounts.purchase_mint.to_account_info();
    let payment_mint_info = ctx.accounts.payment_mint.to_account_info();

    // Validate sale parameters
    Sale::validate(
        params.id,
        params.payment_amount,
        params.max_price_feed_age,
        params.max_tokens_total,
        params.max_tokens_per_user,
        params.start_timestamp,
        params.end_timestamp,
    )?;

    let payment_price_feed_id = get_feed_id_from_hex(&params.price_feed_id_hex)
        .map_err(|_| error!(EarlyPurchaseError::InvalidPriceFeedHex))?;

    sale.initialize(
        params.id,
        ctx.bumps.sale,
        admin.key(),
        params.guard_purchases,
        purchase_mint_info.key(),
        *purchase_mint_info.owner,
        payment_mint_info.key(),
        *payment_mint_info.owner,
        params.payment_amount,
        payment_price_feed_id,
        params.max_price_feed_age,
        params.max_tokens_total,
        params.max_tokens_per_user,
        params.start_timestamp,
        params.end_timestamp,
    );

    Ok(())
}
