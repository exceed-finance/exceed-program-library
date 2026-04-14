use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{error::StakingError, state::*};

#[event]
pub struct NavUpdateEvent {
    pub pair: Pubkey,
    pub old_exchange_rate: u64,
    pub new_exchange_rate: u64,
    pub total_equity: u64,
    pub total_supply: u64,
}

#[derive(Accounts)]
pub struct UpdateNav<'info> {
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(
        mut,
        address = access_control.nav_authority
    )]
    pub nav_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            pair.lst_mint.key().as_ref()
        ],
        bump = pair.pair_bump,
        constraint = pair.pair_type == 1 @ StakingError::PairNotVariableNav,
    )]
    pub pair: Box<Account<'info, Pair>>,

    #[account(address = pair.lst_mint)]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handler(ctx: Context<UpdateNav>, total_equity: u64) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    let pair = &mut ctx.accounts.pair;
    let lst_supply = ctx.accounts.lst_mint.supply;
    let old_exchange_rate = pair.last_yield_change_exchange_rate;

    // Store total equity
    pair.total_equity = total_equity;

    // Compute new exchange rate: total_equity * PRECISION / total_supply
    // If no tokens outstanding, keep current rate
    if lst_supply > 0 {
        let total_equity_u128 = total_equity as u128;
        let precision = crate::state::pair::PRECISION;
        let lst_supply_u128 = lst_supply as u128;

        let new_rate = total_equity_u128
            .checked_mul(precision)
            .ok_or(StakingError::CalculationOverflow)?
            .checked_div(lst_supply_u128)
            .ok_or(StakingError::CalculationOverflow)?;

        let new_rate_u64: u64 = new_rate
            .try_into()
            .map_err(|_| StakingError::CalculationOverflow)?;

        pair.last_yield_change_exchange_rate = new_rate_u64;
    }

    let current_timestamp = Clock::get()?.unix_timestamp;
    pair.last_yield_change_timestamp = current_timestamp;

    emit!(NavUpdateEvent {
        pair: pair.key(),
        old_exchange_rate,
        new_exchange_rate: pair.last_yield_change_exchange_rate,
        total_equity,
        total_supply: lst_supply,
    });

    Ok(())
}
