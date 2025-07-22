use std::str::FromStr;

use crate::{error::EarlyPurchaseError, state::Config};
use anchor_lang::prelude::*;

pub const FIRST_ADMIN_PUBKEY: &'static str = "F3uwzvtbq4iCnHYcarKH9g6kePV9euRdHmfAyUnhTvaZ";

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeConfigParams {
    // Empty for now, can add fields if needed
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Config::SIZE,
        seeds = [Config::PREFIX.as_bytes()],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeConfig>, _params: InitializeConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;

    let admin = &ctx.accounts.admin;
    let first_admin_pubkey = Pubkey::from_str(FIRST_ADMIN_PUBKEY)
        .map_err(|_| error!(EarlyPurchaseError::InvalidAdminPubkey))?;
    require!(
        admin.key() == first_admin_pubkey,
        EarlyPurchaseError::PurchaseAfterEnd
    );

    config.initialize(admin.key());

    Ok(())
}
