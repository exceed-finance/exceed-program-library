use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface},
};

use crate::{
    error::StakingError,
    state::{AccessControl, Pair},
    types::ConversionDirection,
};

const PIK_USDC_PAIR_ADDRESS: Pubkey = pubkey!("EwqMpnBHKEd537E37kcsNU9Qi82uukjVAXsC8K5Kswt7");
const P_USD_MINT_ADDRESS: Pubkey = pubkey!("9ir8o6rj7dJsXXFQPbDZcWCiPx4UDcdTKrYZfnct6GDm");

#[event]
pub struct MigrateEvent {
    pub input_amount: u64,
    pub output_amount: u64,
}

#[derive(Accounts)]
pub struct Migrate<'info> {
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(address = PIK_USDC_PAIR_ADDRESS)]
    pub pair: Box<Account<'info, Pair>>,

    #[account(mut, address = P_USD_MINT_ADDRESS)]
    pub p_usd_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = p_usd_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program,
    )]
    pub staker_p_usd_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = pair.lst_mint)]
    pub pik_usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = staker,
        associated_token::mint = pik_usdc_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_pik_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    // Programs
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Migrate>) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    let pair = &mut ctx.accounts.pair;
    let staker_p_usd_account = &ctx.accounts.staker_p_usd_account;

    let current_timestamp = Clock::get()?.unix_timestamp;

    let input_amount = staker_p_usd_account.amount;
    require!(input_amount > 0, StakingError::InvalidQuantity);

    let lst_amount = pair.calculate_output_amount(
        input_amount,
        current_timestamp,
        ConversionDirection::BaseToLst,
    )?;
    require!(
        lst_amount <= input_amount,
        StakingError::InvalidMigrationOutput
    );

    let signer_seeds: &[&[&[u8]]] = &[&[
        b"lst_mint",
        &pair.lst_symbol.as_bytes(),
        &[pair.lst_mint_bump],
    ]];

    // burn all the pUSD
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                from: staker_p_usd_account.to_account_info(),
                mint: ctx.accounts.p_usd_mint.to_account_info(),
                authority: ctx.accounts.staker.to_account_info(),
            },
        ),
        input_amount,
    )?;

    // remint as pikUSDC
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                authority: ctx.accounts.pik_usdc_mint.to_account_info(),
                to: ctx.accounts.staker_pik_usdc_account.to_account_info(),
                mint: ctx.accounts.pik_usdc_mint.to_account_info(),
            },
            signer_seeds,
        ),
        lst_amount,
    )?;

    emit!(MigrateEvent {
        input_amount,
        output_amount: lst_amount,
    });

    Ok(())
}
