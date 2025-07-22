use anchor_lang::prelude::*;

use crate::state::{Config, Guardian};

#[derive(Accounts)]
pub struct DeleteGuardian<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [Config::PREFIX.as_bytes()],
              bump,
              has_one = admin)]
    pub config: Account<'info, Config>,

    #[account(mut, 
              close = admin)]
    pub guardian: Account<'info, Guardian>,

    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<DeleteGuardian>) -> Result<()> {
    Ok(())
}
