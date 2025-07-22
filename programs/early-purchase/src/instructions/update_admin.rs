use anchor_lang::prelude::*;

use crate::state::Config;

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub new_admin: Signer<'info>,

    #[account(seeds = [Config::PREFIX.as_bytes()],
              bump,
              has_one = admin)]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<UpdateAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    let new_admin = &ctx.accounts.new_admin;

    config.admin = new_admin.key();

    Ok(())
}
