use anchor_lang::prelude::*;

#[account]
pub struct WithdrawalWindow {
    pub pair: Pubkey,                     // Reference to the Pair account
    pub start_time: i64,                  // Window start timestamp
    pub end_time: i64,                    // Window end timestamp
    pub requested_withdrawal_amount: u64, // Total amount of base tokens to be distributed (converted from LST)
    pub total_lst_burned: u64,            // Total LST tokens burned during withdrawal requests
    pub max_withdrawal_amount: u64, // Maximum amount of base tokens that can be withdrawn from this window
    pub earliest_withdrawal_time: i64, // Earliest time withdrawals can be executed
    pub expiration_time: i64,       // Time after which withdrawals expire
    pub base_token_mint: Pubkey,    // Base token mint
    pub base_token_account: Pubkey, // Base token account for this window
    pub is_funded: bool,            // Whether the window has been funded with base tokens
    pub bump: u8,                   // PDA bump
    pub withdrawn_amount: u64,      // Total amount of base tokens withdrawn so far
}
