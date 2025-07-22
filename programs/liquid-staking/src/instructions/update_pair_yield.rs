use crate::state::pair::PRECISION;
use crate::{
    error::StakingError,
    state::{AccessControl, Pair},
    types::AuthorityType,
};
use anchor_lang::prelude::*;

pub const MAX_INTERVAL_APR_RATE: u64 = 1_000_000_000_000_000;

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct UpdatePairYieldParams {
    pub interval_apr_rate: u64,
}

impl UpdatePairYieldParams {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.interval_apr_rate as u128 >= PRECISION,
            StakingError::InvalidYieldRate
        );

        require!(
            self.interval_apr_rate <= MAX_INTERVAL_APR_RATE,
            StakingError::MaxYieldRateExceeded
        );

        Ok(())
    }
}

#[derive(Accounts)]
pub struct UpdatePairYield<'info> {
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

    #[account(address = access_control.pair_authority)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,
}

pub fn handler(ctx: Context<UpdatePairYield>, params: UpdatePairYieldParams) -> Result<()> {
    let access_control = &ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    // Validate params
    params.validate()?;

    let pair = &mut ctx.accounts.pair;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;

    let exchange_rate = pair
        .calculate_exchange_rate(current_timestamp)
        .ok_or(StakingError::CalculationOverflow)?;

    msg!("Exchange Rate: {}", exchange_rate);

    pair.last_yield_change_timestamp = current_timestamp;
    pair.last_yield_change_exchange_rate = exchange_rate;
    pair.interval_apr_rate = params.interval_apr_rate;

    Ok(())
}
