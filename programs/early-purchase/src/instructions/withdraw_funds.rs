use std::u64;

use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::error::EarlyPurchaseError;
use crate::state::{Guardian, Sale};

#[derive(Accounts)]
pub struct WithdrawFunds<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub guardian: Account<'info, Guardian>,

    #[account(mut)]
    pub sale: Account<'info, Sale>,

    // For SPL token withdrawals
    #[account(mut,
              token::mint = sale.payment_mint,
              token::authority = sale,
              token::token_program = payment_program)]
    pub sale_payment_ata: Option<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
              token::mint = sale.payment_mint,
              token::authority = treasury,
              token::token_program = payment_program)]
    pub treasury_payment_ata: Option<InterfaceAccount<'info, TokenAccount>>,

    // For both SPL and SOL withdrawals
    #[account(mut)]
    pub treasury: SystemAccount<'info>,

    pub payment_program: Option<Interface<'info, TokenInterface>>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawFundsParams {
    pub amount: Option<u64>, // Optional for SOL withdrawals, if None, withdraw maximum available
}

pub fn handler(ctx: Context<WithdrawFunds>, params: WithdrawFundsParams) -> Result<()> {
    let sale = &ctx.accounts.sale;
    let _authority = &ctx.accounts.authority;
    let guardian = &ctx.accounts.guardian;
    let treasury = &ctx.accounts.treasury;
    let _system_program = &ctx.accounts.system_program;

    // Check permissions
    require!(
        guardian.permissions.withdraw_funds,
        EarlyPurchaseError::WithdrawWithoutPermission
    );

    // Check that the guardian belongs to the sale creator
    require!(
        guardian.authority == sale.creator,
        EarlyPurchaseError::WithdrawNotCreator
    );

    // Check sale state
    require!(sale.is_ended(), EarlyPurchaseError::WithdrawBeforeEnd);

    // Handle SPL token withdrawal
    if let (Some(sale_payment_ata), Some(treasury_payment_ata), Some(payment_program)) = (
        &ctx.accounts.sale_payment_ata,
        &ctx.accounts.treasury_payment_ata,
        &ctx.accounts.payment_program,
    ) {
        let amount = params.amount.unwrap_or(sale_payment_ata.amount);

        // Skip if no tokens to withdraw
        if amount == 0 {
            return Ok(());
        }

        let sale_id_bytes = sale.id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            Sale::PREFIX.as_bytes(),
            sale_id_bytes.as_ref(),
            &[sale.bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                payment_program.to_account_info(),
                token::Transfer {
                    from: sale_payment_ata.to_account_info(),
                    to: treasury_payment_ata.to_account_info(),
                    authority: sale.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
    } else {
        // Handle SOL withdrawal
        // Calculate rent-exempt minimum for the Sale account
        let rent = Rent::get()?;
        let minimum_balance = rent.minimum_balance(Sale::SIZE);

        // Calculate maximum withdrawable amount
        let withdrawable_amount = sale
            .to_account_info()
            .lamports()
            .checked_sub(minimum_balance)
            .unwrap_or(0);

        // If amount is provided, ensure it's not more than withdrawable
        let amount_to_withdraw = match params.amount {
            Some(amount) => {
                require!(
                    amount <= withdrawable_amount,
                    EarlyPurchaseError::InsufficientFundsToWithdraw
                );
                amount
            }
            None => withdrawable_amount,
        };

        // Skip if no SOL to withdraw
        if amount_to_withdraw == 0 {
            return Ok(());
        }

        // Transfer SOL from sale to treasury by directly modifying lamports
        // This is necessary because the sale account is a PDA that contains data,
        // and the system program's transfer instruction doesn't allow transferring
        // from accounts that contain data.

        // Debit from sale account
        **sale.to_account_info().try_borrow_mut_lamports()? -= amount_to_withdraw;

        // Credit to treasury account
        **treasury.to_account_info().try_borrow_mut_lamports()? += amount_to_withdraw;
    }

    Ok(())
}
