use std::u64;

use anchor_lang::{prelude::*, system_program};
use anchor_spl::token;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::error::EarlyPurchaseError;
use crate::state::{Guardian, Receipt, Sale};

#[derive(Accounts)]
pub struct PurchaseTokens<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    pub authority: Option<Signer<'info>>,

    #[account(has_one = authority)]
    pub guardian: Option<Account<'info, Guardian>>,

    #[account(mut, has_one = payment_program)]
    pub sale: Account<'info, Sale>,

    #[account(init_if_needed,
              payer = buyer,
              space = Receipt::SIZE,
              seeds = [
                Receipt::PREFIX.as_bytes(),
                &buyer.key.to_bytes(),
                &sale.key().to_bytes()
              ],
              bump)]
    pub receipt: Account<'info, Receipt>,

    #[account(mut,
              token::mint = sale.payment_mint,
              token::authority = buyer,
              token::token_program = payment_program)]
    pub buyer_payment_ata: Option<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
              token::mint = sale.payment_mint,
              token::authority = sale,
              token::token_program = payment_program)]
    pub sale_payment_ata: Option<InterfaceAccount<'info, TokenAccount>>,

    pub payment_price_update: Option<Account<'info, PriceUpdateV2>>,

    pub system_program: Program<'info, System>,

    pub payment_program: Interface<'info, TokenInterface>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PurchaseTokensParams {
    pub amount_to_purchase: u64,
    pub max_lamports_to_spend: u64,
}

pub fn handler(ctx: Context<PurchaseTokens>, params: PurchaseTokensParams) -> Result<()> {
    let sale = &mut ctx.accounts.sale;
    let receipt = &mut ctx.accounts.receipt;

    let buyer = &ctx.accounts.buyer;
    let guardian = &ctx.accounts.guardian;
    let authority = &ctx.accounts.authority;
    let buyer_payment_ata_opt = &ctx.accounts.buyer_payment_ata;
    let system_program = &ctx.accounts.system_program;
    let payment_program = &ctx.accounts.payment_program;

    let amount_to_purchase = params.amount_to_purchase;
    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    require!(!sale.is_frozen(), EarlyPurchaseError::PurchaseDuringFreeze);

    require!(
        sale.is_start_time_reached(timestamp),
        EarlyPurchaseError::PurchaseBeforeStart
    );

    require!(
        !sale.is_ended() && !sale.is_end_time_reached(timestamp),
        EarlyPurchaseError::PurchaseAfterEnd
    );

    require!(
        sale.has_purchase_supply(amount_to_purchase),
        EarlyPurchaseError::TotalPurchaseCountReached
    );

    require!(
        receipt.has_supply(amount_to_purchase, sale.max_tokens_per_user),
        EarlyPurchaseError::UserPurchaseCountReached
    );

    if sale.guard_purchases {
        require!(
            authority.is_some(),
            EarlyPurchaseError::PurchaseWithoutGuardianSigner
        );

        require!(
            guardian
                .clone()
                .is_some_and(|guardian| guardian.permissions.verify_purchases),
            EarlyPurchaseError::PurchaseWithoutGuardian
        );
    }

    sale.process_purchase(amount_to_purchase);

    match receipt.is_initialized() {
        false => receipt.initialize(buyer.key(), sale.key(), amount_to_purchase),
        true => receipt.process_purchase(amount_to_purchase),
    }

    match buyer_payment_ata_opt {
        Some(buyer_payment_ata) => {
            let sale_payment_ata = ctx.accounts.sale_payment_ata.clone();

            require!(
                sale_payment_ata.is_some(),
                EarlyPurchaseError::TokenPaymentWithoutTokenAccounts
            );

            token::transfer(
                CpiContext::new(
                    payment_program.to_account_info(),
                    token::Transfer {
                        from: buyer_payment_ata.to_account_info(),
                        to: sale_payment_ata
                            .ok_or_else(|| error!(EarlyPurchaseError::MissingTokenAccount))?
                            .to_account_info(),
                        authority: buyer.to_account_info(),
                    },
                ),
                sale.calculate_base_purchase_cost(amount_to_purchase)?,
            )?;

            Ok(())
        }
        None => {
            let payment_price_update = &ctx.accounts.payment_price_update.as_ref();

            require!(
                payment_price_update.is_some(),
                EarlyPurchaseError::SolPaymentWithoutPriceFeed
            );

            let price = &payment_price_update
                .ok_or_else(|| error!(EarlyPurchaseError::MissingPriceUpdate))?
                .get_price_no_older_than(
                    &clock,
                    sale.max_price_feed_age,
                    &sale.payment_price_feed_id,
                )?;

            let lamports = sale.calculate_purchase_cost(amount_to_purchase, price)?;
            require!(
                lamports <= params.max_lamports_to_spend,
                EarlyPurchaseError::SlippageExceeded
            );

            system_program::transfer(
                CpiContext::new(
                    system_program.to_account_info(),
                    system_program::Transfer {
                        from: buyer.to_account_info(),
                        to: sale.to_account_info(),
                    },
                ),
                lamports,
            )?;

            Ok(())
        }
    }
}
