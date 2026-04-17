use crate::{error::StakingError, state::AccessControl};
use anchor_lang::prelude::*;
use std::str::FromStr;

const FIRST_ADMIN: &str = "CK5biDZPD3bMYBc4HLCci7QxP41KfB2Kn4qgCxJiiRVM"; // Original admin (matches test-keypairs/access-control-creator.json)

#[derive(Accounts)]
pub struct CreateAccessControl<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<AccessControl>(),
        seeds = [b"access_control"],
        bump
    )]
    pub access_control: Account<'info, AccessControl>,

    /// The admin that must sign
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateAccessControl>,
    vault_authority: Pubkey,
    window_authority: Pubkey,
    deposit_authority: Pubkey,
    pair_authority: Pubkey,
    unseal_authority: Pubkey,
    access_authority: Pubkey,
    nav_authority: Pubkey,
) -> Result<()> {
    // Verify the signer is the first admin
    let first_admin = Pubkey::from_str(FIRST_ADMIN).expect("must be a valid pubkey");
    require!(
        ctx.accounts.admin.key() == first_admin,
        StakingError::InvalidFirstAdmin
    );

    // Validate that none of the authority pubkeys is the default pubkey
    require!(
        vault_authority != Pubkey::default(),
        StakingError::DefaultPubkeyNotAllowed
    );
    require!(
        window_authority != Pubkey::default(),
        StakingError::DefaultPubkeyNotAllowed
    );
    require!(
        deposit_authority != Pubkey::default(),
        StakingError::DefaultPubkeyNotAllowed
    );
    require!(
        pair_authority != Pubkey::default(),
        StakingError::DefaultPubkeyNotAllowed
    );
    require!(
        unseal_authority != Pubkey::default(),
        StakingError::DefaultPubkeyNotAllowed
    );
    require!(
        access_authority != Pubkey::default(),
        StakingError::DefaultPubkeyNotAllowed
    );
    require!(
        nav_authority != Pubkey::default(),
        StakingError::DefaultPubkeyNotAllowed
    );

    // Initialize the access control account
    let access_control = &mut ctx.accounts.access_control;
    access_control.vault_authority = vault_authority;
    access_control.window_authority = window_authority;
    access_control.deposit_authority = deposit_authority;
    access_control.pair_authority = pair_authority;
    access_control.unseal_authority = unseal_authority;
    access_control.access_authority = access_authority;
    access_control.nav_authority = nav_authority;

    access_control.is_sealed = false;
    access_control.bump = ctx.bumps.access_control;

    // Initialize whitelist control
    access_control.merkle_root = [0; 32];
    access_control.is_whitelist_enabled = false;

    // Initialize empty guardian slots
    access_control.guardians = [None; 5];

    // Initialize empty pending authorities
    access_control.pending_vault_authority = None;
    access_control.pending_window_authority = None;
    access_control.pending_deposit_authority = None;
    access_control.pending_pair_authority = None;
    access_control.pending_unseal_authority = None;
    access_control.pending_access_authority = None;
    access_control.pending_nav_authority = None;
    access_control.sol_usdc_feed_id = [
        0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda,
        0x39, 0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80,
        0xb5, 0x6d,
    ];

    Ok(())
}
