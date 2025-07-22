use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct GuardianPermissions {
    pub update_config: bool,

    pub verify_purchases: bool,

    pub deposit_tokens: bool,

    pub manage_guardians: bool,

    pub end_sale: bool,

    pub update_sale: bool,

    pub withdraw_funds: bool,
}

#[account]
pub struct Guardian {
    pub authority: Pubkey,

    pub permissions: GuardianPermissions,
}

impl Guardian {
    pub const PREFIX: &'static str = "guardian";

    pub const SIZE: usize = 8 + std::mem::size_of::<Guardian>();

    pub fn initialize(&mut self, authority: Pubkey, permissions: GuardianPermissions) {
        self.authority = authority;
        self.permissions = permissions
    }
}
