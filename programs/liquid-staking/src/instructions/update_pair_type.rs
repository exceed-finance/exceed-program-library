use anchor_lang::prelude::*;

use crate::{error::StakingError, state::*};

#[event]
pub struct PairTypeUpdateEvent {
    pub pair: Pubkey,
    pub old_pair_type: u8,
    pub new_pair_type: u8,
}

#[derive(Accounts)]
pub struct UpdatePairType<'info> {
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(
        mut,
        address = access_control.pair_authority
    )]
    pub pair_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            pair.lst_mint.key().as_ref()
        ],
        bump = pair.pair_bump
    )]
    pub pair: Box<Account<'info, Pair>>,
}

pub fn handler(ctx: Context<UpdatePairType>, new_pair_type: u8) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    require!(
        new_pair_type <= 1,
        StakingError::InvalidPairType
    );

    let pair = &mut ctx.accounts.pair;
    let old_pair_type = pair.pair_type;
    pair.pair_type = new_pair_type;

    emit!(PairTypeUpdateEvent {
        pair: pair.key(),
        old_pair_type,
        new_pair_type,
    });

    Ok(())
}
