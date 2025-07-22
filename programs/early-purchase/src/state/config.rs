use anchor_lang::prelude::*;
// use pyth_solana_receiver_sdk::price_update::{FeedId, Price};

#[account]
pub struct Config {
    pub admin: Pubkey,
}

impl Config {
    pub const PREFIX: &'static str = "config";

    pub const SIZE: usize = 8 + std::mem::size_of::<Config>();

    pub fn initialize(&mut self, admin: Pubkey) {
        self.admin = admin;
    }
}
