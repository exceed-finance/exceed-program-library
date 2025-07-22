use anchor_lang::prelude::*;

use crate::state::{Config, Guardian, GuardianPermissions};

#[derive(Accounts)]
pub struct UpdateGuardian<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [Config::PREFIX.as_bytes()],
              bump,
              has_one = admin)]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub guardian: Account<'info, Guardian>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateGuardianParams {
    pub permissions: GuardianPermissions,
}

pub fn handler(ctx: Context<UpdateGuardian>, params: UpdateGuardianParams) -> Result<()> {
    let guardian = &mut ctx.accounts.guardian;

    guardian.permissions = params.permissions;

    Ok(())
}
