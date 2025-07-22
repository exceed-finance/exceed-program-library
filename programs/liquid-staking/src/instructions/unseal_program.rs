use crate::state::AccessControl;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UnsealProgram<'info> {
    #[account(address = access_control.unseal_authority)]
    pub unseal_authority: Signer<'info>,

    #[account(mut)]
    pub access_control: Account<'info, AccessControl>,
}

pub fn handler(ctx: Context<UnsealProgram>) -> Result<()> {
    ctx.accounts.access_control.is_sealed = false;

    Ok(())
}
