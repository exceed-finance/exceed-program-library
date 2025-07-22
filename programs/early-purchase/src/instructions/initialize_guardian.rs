use anchor_lang::prelude::*;

use crate::state::{Config, Guardian, GuardianPermissions};

#[derive(Accounts)]
#[instruction(params: InitializeGuardianParams)]
pub struct InitializeGuardian<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [Config::PREFIX.as_bytes()],
              bump,
              has_one = admin)]
    pub config: Account<'info, Config>,

    #[account(init,
              payer = admin,
              space = Guardian::SIZE,
              seeds = [
                Guardian::PREFIX.as_bytes(),
                &params.authority.to_bytes(),
              ],
              bump)]
    pub guardian: Account<'info, Guardian>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeGuardianParams {
    pub authority: Pubkey,

    pub permissions: GuardianPermissions,
}

pub fn handler(ctx: Context<InitializeGuardian>, params: InitializeGuardianParams) -> Result<()> {
    let guardian = &mut ctx.accounts.guardian;

    guardian.initialize(params.authority, params.permissions);

    Ok(())
}
