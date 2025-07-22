use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    error::EarlyPurchaseError,
    state::{Guardian, Sale, SaleState},
};

#[derive(Accounts)]
pub struct FreezeSale<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub guardian: Account<'info, Guardian>,

    #[account(mut)]
    pub sale: Account<'info, Sale>,
}

pub fn handler(ctx: Context<FreezeSale>) -> Result<()> {
    let sale = &mut ctx.accounts.sale;

    let guardian = &ctx.accounts.guardian;
    require!(
        guardian.permissions.update_sale,
        EarlyPurchaseError::PurchaseWithoutGuardian
    );

    match sale.state {
        SaleState::Active => {
            sale.state = SaleState::Frozen;
        }
        SaleState::Frozen => {
            sale.state = SaleState::Active;
        }
        SaleState::Ended => {
            return Err(EarlyPurchaseError::FreezeAfterEnd.into());
        }
    }

    Ok(())
}
