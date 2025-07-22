use anchor_lang::prelude::*;

#[account]
pub struct Receipt {
    pub buyer: Pubkey,

    pub sale: Pubkey,

    pub num_tokens_purchased: u64,

    pub num_tokens_redeemed: u64,
}

impl Receipt {
    pub const PREFIX: &'static str = "receipt";

    pub const SIZE: usize = 8 + std::mem::size_of::<Receipt>();

    pub fn initialize(&mut self, buyer: Pubkey, sale: Pubkey, initial_tokens_purchased: u64) {
        self.buyer = buyer;
        self.sale = sale;
        self.num_tokens_purchased = initial_tokens_purchased;
    }

    pub fn is_initialized(&self) -> bool {
        self.num_tokens_purchased > 0
    }

    pub fn has_supply(&self, amount_to_purchase: u64, max_tokens_per_user: Option<u64>) -> bool {
        match max_tokens_per_user {
            None => true,
            Some(max_tokens) => self.num_tokens_purchased + amount_to_purchase <= max_tokens,
        }
    }

    pub fn calculate_pending_tokens(&self) -> Result<u64> {
        self.num_tokens_purchased
            .checked_sub(self.num_tokens_redeemed)
            .ok_or_else(|| error!(crate::error::EarlyPurchaseError::CalculationUnderflow))
    }

    pub fn process_purchase(&mut self, num_tokens_purchased: u64) {
        self.num_tokens_purchased += num_tokens_purchased;
    }

    pub fn process_redemption(&mut self) {
        self.num_tokens_redeemed = self.num_tokens_purchased;
    }
}
