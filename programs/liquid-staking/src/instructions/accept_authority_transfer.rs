use crate::{error::StakingError, state::AccessControl, types::AuthorityType};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AcceptAuthorityTransfer<'info> {
    #[account(mut)]
    pub access_control: Account<'info, AccessControl>,

    /// The new authority that must sign
    pub new_authority: Signer<'info>,
}

pub fn handler(ctx: Context<AcceptAuthorityTransfer>, authority_type: AuthorityType) -> Result<()> {
    let access_control = &mut ctx.accounts.access_control;
    access_control.verify_unsealed()?;
    let new_authority = ctx.accounts.new_authority.key();

    // Get the pending authority
    let pending_authority = access_control
        .get_pending_authority(&authority_type)
        .ok_or(StakingError::NoPendingAuthority)?;

    // Verify the signer is the pending authority
    require!(
        new_authority == pending_authority,
        StakingError::InvalidPendingAuthority
    );

    // Complete the transfer
    access_control.complete_authority_transfer(&authority_type, new_authority);

    Ok(())
}
