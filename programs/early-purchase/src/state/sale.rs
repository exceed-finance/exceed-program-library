use anchor_lang::{prelude::*, solana_program::native_token::LAMPORTS_PER_SOL, Result};
use pyth_solana_receiver_sdk::price_update::{FeedId, Price};

use crate::constants;
use crate::error::EarlyPurchaseError;

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Eq)]
pub enum SaleState {
    Active,
    Frozen,
    Ended,
}

#[account]
pub struct Sale {
    pub id: u64,
    pub bump: u8,
    pub state: SaleState,
    pub creator: Pubkey,

    pub guard_purchases: bool,

    pub max_tokens_total: Option<u64>,
    pub max_tokens_per_user: Option<u64>,

    pub start_timestamp: Option<i64>,
    pub end_timestamp: Option<i64>,

    pub purchase_mint: Pubkey,
    pub purchase_program: Pubkey,

    pub payment_mint: Pubkey,
    pub payment_program: Pubkey,
    pub payment_amount: u64,

    pub payment_price_feed_id: [u8; 32],
    pub max_price_feed_age: u64,

    pub num_tokens_purchased: u64,
    pub num_tokens_deposited: u64,
    pub num_tokens_distributed: u64,
}

impl Sale {
    pub const PREFIX: &'static str = "sale";

    pub const SIZE: usize = 8 + std::mem::size_of::<Sale>();

    pub fn initialize(
        &mut self,
        id: u64,
        bump: u8,
        creator: Pubkey,
        guard_purchases: bool,
        purchase_mint: Pubkey,
        purchase_program: Pubkey,
        payment_mint: Pubkey,
        payment_program: Pubkey,
        payment_amount: u64,
        payment_price_feed_id: [u8; 32],
        max_price_feed_age: u64,
        max_tokens_total: Option<u64>,
        max_tokens_per_user: Option<u64>,
        start_timestamp: Option<i64>,
        end_timestamp: Option<i64>,
    ) {
        self.id = id;
        self.bump = bump;
        self.creator = creator;
        self.guard_purchases = guard_purchases;
        self.purchase_mint = purchase_mint;
        self.purchase_program = purchase_program;
        self.payment_mint = payment_mint;
        self.payment_program = payment_program;
        self.payment_amount = payment_amount;
        self.payment_price_feed_id = payment_price_feed_id;
        self.max_price_feed_age = max_price_feed_age;
        self.max_tokens_total = max_tokens_total;
        self.max_tokens_per_user = max_tokens_per_user;
        self.start_timestamp = start_timestamp;
        self.end_timestamp = end_timestamp;
    }

    pub fn get_payment_feed_id(&self) -> FeedId {
        self.payment_price_feed_id.into()
    }

    pub fn is_frozen(&self) -> bool {
        self.state == SaleState::Frozen
    }

    pub fn is_ended(&self) -> bool {
        self.state == SaleState::Ended
    }

    pub fn is_start_time_reached(&self, timestamp: i64) -> bool {
        match self.start_timestamp {
            None => true,
            Some(start_timestamp) => timestamp >= start_timestamp,
        }
    }

    pub fn is_end_time_reached(&self, timestamp: i64) -> bool {
        match self.end_timestamp {
            None => false,
            Some(end_timestamp) => timestamp > end_timestamp,
        }
    }

    pub fn has_purchase_supply(&self, amount_to_purchase: u64) -> bool {
        match self.max_tokens_total {
            None => true,
            Some(max_tokens) => {
                match self.calculate_new_purchase_count(amount_to_purchase) {
                    Ok(new_count) => new_count <= max_tokens,
                    Err(_) => false, // If overflow, deny the purchase
                }
            }
        }
    }

    pub fn has_deposit_supply(&self, amount_to_deposit: u64) -> bool {
        match self.calculate_new_deposit_count(amount_to_deposit) {
            Ok(new_count) => new_count <= self.num_tokens_purchased,
            Err(_) => false, // If overflow, deny the deposit
        }
    }

    pub fn calculate_new_purchase_count(&self, amount_to_purchase: u64) -> Result<u64> {
        self.num_tokens_purchased
            .checked_add(amount_to_purchase)
            .ok_or_else(|| error!(EarlyPurchaseError::CalculationOverflow))
    }

    pub fn calculate_new_deposit_count(&self, amount_to_deposit: u64) -> Result<u64> {
        self.num_tokens_deposited
            .checked_add(amount_to_deposit)
            .ok_or_else(|| error!(EarlyPurchaseError::CalculationOverflow))
    }

    /// Calculates the base purchase cost in micropennies (millionths of a dollar)
    ///
    /// The payment_amount is in micropennies, where:
    /// - 1 micropenny = $0.000001
    /// - 1,000,000 micropennies = $1.00
    ///
    /// This function simply multiplies the payment_amount by the number of tokens to purchase
    pub fn calculate_base_purchase_cost(&self, amount_to_purchase: u64) -> Result<u64> {
        self.payment_amount
            .checked_mul(amount_to_purchase)
            .ok_or_else(|| error!(EarlyPurchaseError::BaseCostCalculationOverflow))
    }

    /// Calculates the purchase cost in lamports based on the SOL/USD price feed
    ///
    /// The payment_amount is in micropennies (millionths of a dollar), where:
    /// - 1 micropenny = $0.000001
    /// - 1,000,000 micropennies = $1.00
    ///
    /// For example, if payment_amount = 1 and amount_to_purchase = 1:
    /// - The base cost is 1 micropenny ($0.000001)
    /// - If SOL price is $169.195, the user pays approximately 0.000005910 SOL (5,910 lamports)
    ///
    /// If payment_amount = 1,000,000 (representing $1.00) and amount_to_purchase = 1:
    /// - The base cost is 1,000,000 micropennies ($1.00)
    /// - If SOL price is $169.195, the user pays approximately 0.00591 SOL (5,910,000 lamports)
    pub fn calculate_purchase_cost(&self, amount_to_purchase: u64, price: &Price) -> Result<u64> {
        // Convert price to u128 for safer arithmetic
        let p: u128 = price
            .price
            .try_into()
            .map_err(|_| EarlyPurchaseError::InvalidPrice)?;

        // Convert other values to u128 for intermediate calculations
        // Base cost is in micropennies (millionths of a dollar)
        let base_cost_u64 = self.calculate_base_purchase_cost(amount_to_purchase)?;
        let base_cost: u128 = base_cost_u64 as u128;
        let lamports_per_sol: u128 = LAMPORTS_PER_SOL as u128;

        // Get absolute value of exponent and convert to u32 for pow operation
        let exponent: u32 = price
            .exponent
            .abs()
            .try_into()
            .map_err(|_| EarlyPurchaseError::InvalidPrice)?;

        // Calculate 10^|exponent| as u128
        let scaling_factor = 10_u128.pow(exponent);

        // Scale lamports_per_sol by the scaling factor
        let scaled_lamports = lamports_per_sol
            .checked_mul(scaling_factor)
            .ok_or(EarlyPurchaseError::AritmeticOverflow)?;

        // Complete the calculation with u128 arithmetic
        // Formula: lamports = (LAMPORTS_PER_SOL * 10^|exponent| * base_cost) / price
        // Where base_cost is in micropennies (millionths of a dollar)
        let total_cost = scaled_lamports
            .checked_mul(base_cost)
            .ok_or(EarlyPurchaseError::AritmeticOverflow)?
            .checked_div(p)
            .ok_or(EarlyPurchaseError::AritmeticOverflow)?;

        // Convert back to u64 if within range
        let lamports =
            u64::try_from(total_cost).map_err(|_| EarlyPurchaseError::AritmeticOverflow)?;

        msg!(
            "amount: {:?}, base_cost: {:?}, price: {:?}, scaling_factor: {:?}, total_cost: {:?}, lamports: {:?}",
            amount_to_purchase,
            base_cost,
            price,
            scaling_factor,
            total_cost,
            lamports
        );
        msg!("scaled_lamports: {:?}", scaled_lamports);
        Ok(lamports)
    }

    pub fn calculate_available_tokens(&self) -> Result<u64> {
        self.num_tokens_deposited
            .checked_sub(self.num_tokens_distributed)
            .ok_or_else(|| error!(EarlyPurchaseError::CalculationUnderflow))
    }

    pub fn process_purchase(&mut self, amount_purchased: u64) {
        self.num_tokens_purchased += amount_purchased
    }

    pub fn process_deposit(&mut self, amount_deposited: u64) {
        self.num_tokens_deposited += amount_deposited
    }

    pub fn process_redemption(&mut self, amount_redeemed: u64) {
        self.num_tokens_distributed += amount_redeemed
    }

    /// Validates sale parameters during initialization
    pub fn validate(
        id: u64,
        payment_amount: u64,
        max_price_feed_age: u64,
        max_tokens_total: Option<u64>,
        max_tokens_per_user: Option<u64>,
        start_timestamp: Option<i64>,
        end_timestamp: Option<i64>,
    ) -> Result<()> {
        // Validate ID
        require!(
            id <= constants::MAX_SALE_ID,
            EarlyPurchaseError::InvalidSaleId
        );

        // Validate payment amount
        require!(payment_amount > 0, EarlyPurchaseError::InvalidPaymentAmount);

        // Validate max_price_feed_age
        require!(
            max_price_feed_age > 0,
            EarlyPurchaseError::InvalidPriceFeedAge
        );

        // Validate token amounts
        if let (Some(max_total), Some(max_per_user)) = (max_tokens_total, max_tokens_per_user) {
            require!(
                max_per_user <= max_total,
                EarlyPurchaseError::InvalidTokenAmounts
            );
        }

        // Validate timestamps
        if let (Some(start), Some(end)) = (start_timestamp, end_timestamp) {
            require!(start < end, EarlyPurchaseError::InvalidSaleTimeframe);

            // Validate sale duration is reasonable
            let duration = end
                .checked_sub(start)
                .ok_or_else(|| error!(EarlyPurchaseError::InvalidTimeframeCalculation))?;
            require!(
                duration >= constants::MIN_SALE_DURATION,
                EarlyPurchaseError::SaleDurationTooShort
            );

            // Validate sale is not too far in the future
            let clock = Clock::get()?;
            require!(
                start.checked_sub(clock.unix_timestamp).unwrap_or(0)
                    <= constants::MAX_FUTURE_START_TIME,
                EarlyPurchaseError::StartTimeTooFarInFuture
            );
        }

        Ok(())
    }

    /// Validates sale parameters during updates
    pub fn validate_update(
        &self,
        payment_amount: Option<u64>,
        max_tokens_total: Option<Option<u64>>,
        max_tokens_per_user: Option<Option<u64>>,
        start_timestamp: Option<Option<i64>>,
        end_timestamp: Option<Option<i64>>,
    ) -> Result<()> {
        // Validate payment amount if being updated
        if let Some(amount) = payment_amount {
            require!(amount > 0, EarlyPurchaseError::InvalidPaymentAmount);
        }

        // Determine the effective values after update
        let effective_max_total = max_tokens_total.unwrap_or(self.max_tokens_total);
        let effective_max_per_user = max_tokens_per_user.unwrap_or(self.max_tokens_per_user);
        let effective_start = start_timestamp.unwrap_or(self.start_timestamp);
        let effective_end = end_timestamp.unwrap_or(self.end_timestamp);

        // Validate token amounts
        if let (Some(max_total), Some(max_per_user)) = (effective_max_total, effective_max_per_user)
        {
            require!(
                max_per_user <= max_total,
                EarlyPurchaseError::InvalidTokenAmounts
            );
        }

        // Validate timestamps
        if let (Some(start), Some(end)) = (effective_start, effective_end) {
            require!(start < end, EarlyPurchaseError::InvalidSaleTimeframe);

            // Validate sale duration is reasonable
            let duration = end
                .checked_sub(start)
                .ok_or_else(|| error!(EarlyPurchaseError::InvalidTimeframeCalculation))?;
            require!(
                duration >= constants::MIN_SALE_DURATION,
                EarlyPurchaseError::SaleDurationTooShort
            );

            // Validate sale is not too far in the future
            let clock = Clock::get()?;
            require!(
                start.checked_sub(clock.unix_timestamp).unwrap_or(0)
                    <= constants::MAX_FUTURE_START_TIME,
                EarlyPurchaseError::StartTimeTooFarInFuture
            );
        }

        Ok(())
    }
}
