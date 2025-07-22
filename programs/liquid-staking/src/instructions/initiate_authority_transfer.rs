use crate::{error::StakingError, state::AccessControl, types::AuthorityType};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitiateAuthorityTransfer<'info> {
    #[account(
        mut,
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Account<'info, AccessControl>,

    /// The current authority that must sign
    pub current_authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<InitiateAuthorityTransfer>,
    authority_type: AuthorityType,
    new_authority: Pubkey,
) -> Result<()> {
    let access_control = &mut ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    let current_authority = ctx.accounts.current_authority.key();

    // Verify the current authority
    let expected_authority = access_control.get_authority(&authority_type);
    require!(
        current_authority == expected_authority,
        StakingError::InvalidAuthority
    );

    // Check if there's already a pending transfer
    require!(
        access_control
            .get_pending_authority(&authority_type)
            .is_none(),
        StakingError::PendingAuthorityExists
    );

    // Set the pending authority
    access_control.set_pending_authority(&authority_type, new_authority);

    Ok(())
}
