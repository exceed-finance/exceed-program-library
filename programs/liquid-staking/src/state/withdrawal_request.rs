use anchor_lang::prelude::*;

// Account size:
// 8 (discriminator) +
// 32 (staker pubkey) +
// 32 (window pubkey) +
// 8 (lst_amount) +
// 8 (lst_fee_amount)
// 8 (base_amount) +
// 1 (bump)
pub const WITHDRAWAL_REQUEST_LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1;

#[account]
pub struct WithdrawalRequest {
    pub staker: Pubkey,      // Staker who requested withdrawal
    pub window: Pubkey,      // Reference to the withdrawal window
    pub lst_amount: u64,     // Amount of LST burned for withdrawal
    pub lst_fee_amount: u64, // Amount of LST transfered for withdrawal fee
    pub base_amount: u64,    // Amount of base tokens to receive
    pub bump: u8,            // PDA bump
}
