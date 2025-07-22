use anchor_lang::prelude::*;

use crate::error::EarlyPurchaseError;
use crate::state::{Guardian, Sale, SaleState};

#[derive(Accounts)]
pub struct EndSale<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub guardian: Account<'info, Guardian>,

    #[account(mut)]
    pub sale: Account<'info, Sale>,
}

pub fn handler(ctx: Context<EndSale>) -> Result<()> {
    let sale = &mut ctx.accounts.sale;

    let guardian = &ctx.accounts.guardian;

    let timestamp = Clock::get()?.unix_timestamp;
    require!(
        sale.is_end_time_reached(timestamp),
        EarlyPurchaseError::EarlyEnd
    );

    require!(
        guardian.permissions.end_sale,
        EarlyPurchaseError::GuardianMissingPermission
    );

    sale.state = SaleState::Ended;

    Ok(())
}
