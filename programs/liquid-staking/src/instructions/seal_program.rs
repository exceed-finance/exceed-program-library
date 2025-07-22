use crate::state::AccessControl;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SealProgram<'info> {
    /// The guardian that must sign
    pub guardian: Signer<'info>,

    #[account(
        mut,
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Account<'info, AccessControl>,
}

pub fn handler(ctx: Context<SealProgram>) -> Result<()> {
    // Verify the signer is a guardian
    ctx.accounts
        .access_control
        .verify_guardian(ctx.accounts.guardian.key())?;

    // Seal the program
    ctx.accounts.access_control.is_sealed = true;

    Ok(())
}
