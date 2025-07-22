use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{error::StakingError, state::*};

#[derive(Accounts)]
pub struct CloseWithdrawalWindow<'info> {
    pub access_control: Box<Account<'info, AccessControl>>,
    #[account(

        seeds = [
            b"pair",
            base_token_mint.key().as_ref(),
            pair.lst_mint.key().as_ref()
        ],
        bump = pair.pair_bump
    )]
    pub pair: Box<Account<'info, Pair>>,

    #[account(
        mut,
        associated_token::mint = pair.base_token_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program,
    )]
    pub pair_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = pair.lst_mint,
        associated_token::authority = pair,
        associated_token::token_program = token_program,
    )]
    pub pair_lst_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        address = pair.base_token_mint
    )]
    pub base_token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        address = pair.lst_mint
    )]
    pub lst_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        close = authority,
        seeds = [
            b"withdrawal_window",
            pair.key().as_ref(),
            withdrawal_window.start_time.to_le_bytes().as_ref(),
        ],
        bump = withdrawal_window.bump,
        constraint = withdrawal_window.pair == pair.key() @ StakingError::InvalidSymbol,
    )]
    pub withdrawal_window: Account<'info, WithdrawalWindow>,

    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = withdrawal_window,
        associated_token::token_program = token_program
    )]
    pub window_base_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = pair.lst_mint,
        associated_token::authority = withdrawal_window,
        associated_token::token_program = token_program
    )]
    pub window_lst_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        address = access_control.window_authority
    )]
    pub authority: Signer<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CloseWithdrawalWindow>) -> Result<()> {
    let access_control = &ctx.accounts.access_control;
    access_control.verify_unsealed()?;

    let withdrawal_window = &ctx.accounts.withdrawal_window;
    let window_base_token_account = &ctx.accounts.window_base_token_account;
    let window_lst_account = &ctx.accounts.window_lst_account;

    // Verify all requests have been executed
    require!(
        withdrawal_window.withdrawn_amount == withdrawal_window.requested_withdrawal_amount,
        StakingError::WindowHasActiveRequests
    );

    // Store references to avoid temporary value issues
    let pair_key = ctx.accounts.pair.key();
    let start_time_bytes = withdrawal_window.start_time.to_le_bytes();

    // Prepare seeds for withdrawal window
    let seeds = &[
        b"withdrawal_window".as_ref(),
        pair_key.as_ref(),
        start_time_bytes.as_ref(),
        &[ctx.accounts.withdrawal_window.bump],
    ];

    if window_base_token_account.amount > 0 {
        let decimals = ctx.accounts.base_token_mint.decimals;
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.window_base_token_account.to_account_info(),
                    mint: ctx.accounts.base_token_mint.to_account_info(),
                    to: ctx.accounts.pair_base_token_account.to_account_info(),
                    authority: ctx.accounts.withdrawal_window.to_account_info(),
                },
                &[&seeds[..]],
            ),
            window_base_token_account.amount,
            decimals,
        )?;
    }

    if window_lst_account.amount > 0 {
        let decimals = ctx.accounts.base_token_mint.decimals;
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.window_lst_account.to_account_info(),
                    mint: ctx.accounts.lst_mint.to_account_info(),
                    to: ctx.accounts.pair_lst_account.to_account_info(),
                    authority: ctx.accounts.withdrawal_window.to_account_info(),
                },
                &[&seeds[..]],
            ),
            window_lst_account.amount,
            decimals,
        )?;
    }

    // Close the token account using withdrawal window authority
    anchor_spl::token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token::CloseAccount {
            account: ctx.accounts.window_base_token_account.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: ctx.accounts.withdrawal_window.to_account_info(),
        },
        &[&seeds[..]],
    ))?;

    anchor_spl::token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token::CloseAccount {
            account: ctx.accounts.window_lst_account.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: ctx.accounts.withdrawal_window.to_account_info(),
        },
        &[&seeds[..]],
    ))?;

    // The withdrawal window account will be automatically closed
    // due to the close = authority constraint

    Ok(())
}
