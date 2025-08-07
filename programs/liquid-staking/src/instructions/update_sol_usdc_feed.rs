use anchor_lang::prelude::*;

use crate::state::AccessControl;

#[derive(Accounts)]
pub struct UpdateSolUsdcFeed<'info> {
    #[account(
        mut,
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Account<'info, AccessControl>,

    #[account(address = access_control.access_authority)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateSolUsdcFeed>, new_feed_id: [u8; 32]) -> Result<()> {
    let access_control = &mut ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    // Update the SOL/USDC feed ID
    access_control.sol_usdc_feed_id = new_feed_id;

    Ok(())
}
