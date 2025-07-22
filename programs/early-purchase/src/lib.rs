#![allow(unexpected_cfgs)]
pub mod error;
pub mod instructions;
pub mod state;

pub mod constants {
    pub const MIN_SALE_DURATION: i64 = 300; // 5 minutes minimum sale duration
    pub const MAX_FUTURE_START_TIME: i64 = 31536000; // 1 year maximum future start time
    pub const MAX_SALE_ID: u64 = 1_000_000; // Example maximum sale ID
}

use crate::instructions::*;
use anchor_lang::prelude::*;

declare_id!("EmzVeKtVHRc6AuzrJtowoJ5qfEkpK1R9WzAmcnjzgF1V");

#[program]
pub mod early_purchase {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        params: InitializeConfigParams,
    ) -> Result<()> {
        initialize_config::handler(ctx, params)
    }

    pub fn initialize_sale(
        ctx: Context<InitializeSale>,
        params: InitializeSaleParams,
    ) -> Result<()> {
        initialize_sale::handler(ctx, params)
    }

    pub fn update_sale(ctx: Context<UpdateSale>, params: UpdateSaleParams) -> Result<()> {
        update_sale::handler(ctx, params)
    }

    pub fn update_admin(ctx: Context<UpdateAdmin>) -> Result<()> {
        update_admin::handler(ctx)
    }

    pub fn initialize_guardian(
        ctx: Context<InitializeGuardian>,
        params: InitializeGuardianParams,
    ) -> Result<()> {
        initialize_guardian::handler(ctx, params)
    }

    pub fn update_guardian(
        ctx: Context<UpdateGuardian>,
        params: UpdateGuardianParams,
    ) -> Result<()> {
        update_guardian::handler(ctx, params)
    }

    pub fn delete_guardian(ctx: Context<DeleteGuardian>) -> Result<()> {
        delete_guardian::handler(ctx)
    }

    pub fn purchase_tokens(
        ctx: Context<PurchaseTokens>,
        params: PurchaseTokensParams,
    ) -> Result<()> {
        purchase_tokens::handler(ctx, params)
    }

    pub fn freeze_sale(ctx: Context<FreezeSale>) -> Result<()> {
        freeze_sale::handler(ctx)
    }

    pub fn end_sale(ctx: Context<EndSale>) -> Result<()> {
        end_sale::handler(ctx)
    }

    pub fn deposit_tokens(ctx: Context<DepositTokens>, params: DepositTokensParams) -> Result<()> {
        deposit_tokens::handler(ctx, params)
    }

    pub fn redeem_receipt(ctx: Context<RedeemReceipt>) -> Result<()> {
        redeem_receipt::handler(ctx)
    }

    pub fn withdraw_funds(ctx: Context<WithdrawFunds>, params: WithdrawFundsParams) -> Result<()> {
        withdraw_funds::handler(ctx, params)
    }
}
