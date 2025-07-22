use crate::{error::StakingError, state::AccessControl};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum GuardianOperation {
    Add,
    Remove,
}
#[derive(Accounts)]
pub struct ManageGuardian<'info> {
    #[account(address = access_control.unseal_authority)]
    pub unseal_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Account<'info, AccessControl>,
}

pub fn handler(
    ctx: Context<ManageGuardian>,
    guardian: Pubkey,
    operation: GuardianOperation,
) -> Result<()> {
    match operation {
        GuardianOperation::Add => {
            // Check if guardian already exists
            if ctx
                .accounts
                .access_control
                .guardians
                .contains(&Some(guardian))
            {
                return err!(StakingError::GuardianAlreadyExists);
            }

            // Find first empty slot and add guardian
            let empty_slot = ctx
                .accounts
                .access_control
                .guardians
                .iter_mut()
                .find(|slot| slot.is_none())
                .ok_or(StakingError::NoGuardianSlots)?;
            *empty_slot = Some(guardian);
        }
        GuardianOperation::Remove => {
            // Find and remove the guardian
            let slot = ctx
                .accounts
                .access_control
                .guardians
                .iter_mut()
                .find(|slot| **slot == Some(guardian))
                .ok_or(StakingError::GuardianNotFound)?;
            *slot = None;
        }
    }
    Ok(())
}
