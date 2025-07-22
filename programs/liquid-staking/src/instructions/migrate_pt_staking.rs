use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface},
};

use crate::state::Pair;

#[derive(Accounts)]
#[instruction(symbol: String)]
pub struct Migrate<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    // hardcoded new usdc pair
    #[account(
        mut, 
        address = Pubkey::from_str("").unwrap()
    )]
    pub pair: Box<Account<'info, Pair>>,

    // hardcoded old USDC LST mint
    #[account(address = Pubkey::from_str("").unwrap())]
    pub old_lst_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = old_lst_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_old_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = pair.lst_mint,
    )]
    pub new_lst_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = staker,
        associated_token::mint = new_lst_mint,
        associated_token::authority = staker,
        associated_token::token_program = token_program
    )]
    pub staker_new_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    // Programs
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// Take old USDC LST ATA, burn all the tokens
// Mint an equivalent amount of pikUSDC

// Check old UserStake struct
// If amount > 0, unstake the rest of the USDC through CPI
// Restake it on the spot for more pikUSDC

pub fn migrate(ctx: &Context<Migrate>) -> Result<()> {
    let pair = &ctx.accounts.pair;
    let staker_old_lst_account = &ctx.accounts.staker_old_lst_account;

    let lst_amount = staker_old_lst_account.amount;

    // burn all the old LSTs
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                from: staker_old_lst_account.to_account_info(),
                mint: ctx.accounts.old_lst_mint.to_account_info(),
                authority: ctx.accounts.staker.to_account_info(),
            },
        ),
        lst_amount,
    )?;

    // remint as new LSTs
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                authority: ctx.accounts.new_lst_mint.to_account_info(),
                to: ctx.accounts.staker_new_lst_account.to_account_info(),
                mint: ctx.accounts.new_lst_mint.to_account_info(),
            },
            &[&[
                b"lst_mint",
                &pair.lst_symbol.as_bytes(),
                &[pair.lst_mint_bump],
            ]],
        ),
        lst_amount,
    )?;

    Ok(())
}
