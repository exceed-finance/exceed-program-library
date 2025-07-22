use anchor_lang::prelude::*;

use crate::state::AccessControl;

#[derive(Accounts)]
pub struct UpdateWhitelist<'info> {
    #[account(
        mut,
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Account<'info, AccessControl>,

    #[account(address = access_control.access_authority)]
    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateWhitelist>,
    merkle_root: Option<[u8; 32]>,
    enable_whitelist: Option<bool>,
) -> Result<()> {
    let access_control = &mut ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    // Update merkle root if provided
    if let Some(root) = merkle_root {
        access_control.merkle_root = root;
    }

    // Update whitelist enabled flag if provided
    if let Some(enabled) = enable_whitelist {
        access_control.is_whitelist_enabled = enabled;
    }

    Ok(())
}
