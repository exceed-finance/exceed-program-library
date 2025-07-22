use crate::{error::StakingError, state::AccessControl, types::AuthorityType};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelAuthorityTransfer<'info> {
    #[account(mut)]
    pub access_control: Account<'info, AccessControl>,

    /// The current authority that must sign
    pub current_authority: Signer<'info>,
}

pub fn handler(ctx: Context<CancelAuthorityTransfer>, authority_type: AuthorityType) -> Result<()> {
    let access_control = &mut ctx.accounts.access_control;
    access_control.verify_unsealed()?;
    let current_authority = ctx.accounts.current_authority.key();

    // Verify the current authority
    let expected_authority = access_control.get_authority(&authority_type);
    require!(
        current_authority == expected_authority,
        StakingError::InvalidAuthority
    );

    // Check if there's a pending transfer to cancel
    require!(
        access_control
            .get_pending_authority(&authority_type)
            .is_some(),
        StakingError::NoPendingAuthorityToCancel
    );

    // Clear the pending authority
    access_control.clear_pending_authority(&authority_type);

    Ok(())
}
