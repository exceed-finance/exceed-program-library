use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::{error::StakingError, state::AccessControl};

/// Migrate a Pair account to v2 layout (add pair_type + total_equity fields).
/// Must be called for each existing pair after program upgrade.
#[derive(Accounts)]
pub struct MigratePairV2<'info> {
    #[account(
        seeds = [b"access_control"],
        bump = access_control.bump
    )]
    pub access_control: Box<Account<'info, AccessControl>>,

    #[account(
        mut,
        address = access_control.pair_authority
    )]
    pub pair_authority: Signer<'info>,

    /// CHECK: We manually handle deserialization because the account may be in old layout.
    /// Verified via seeds constraint.
    #[account(mut)]
    pub pair: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn migrate_pair_handler(ctx: Context<MigratePairV2>) -> Result<()> {
    let pair_info = ctx.accounts.pair.to_account_info();
    let data = pair_info.try_borrow_data()?;
    let current_len = data.len();
    drop(data);

    // New Pair struct adds pair_type (u8) + total_equity (u64) = 9 bytes
    let new_size = current_len + 9;

    // Transfer lamports from payer to account to cover additional rent
    let rent = Rent::get()?;
    let new_rent = rent.minimum_balance(new_size);
    let current_lamports = pair_info.lamports();
    if new_rent > current_lamports {
        let diff = new_rent - current_lamports;
        let payer = &ctx.accounts.pair_authority;
        **payer.to_account_info().try_borrow_mut_lamports()? -= diff;
        **pair_info.try_borrow_mut_lamports()? += diff;
    }

    // Reallocate
    pair_info.realloc(new_size, false)?;

    // Append default values at the end:
    // pair_type: u8 = 0 (Fixed)
    // total_equity: u64 = 0
    let mut data = pair_info.try_borrow_mut_data()?;
    // realloc(size, zero_init=false) does NOT zero new bytes on Solana
    // So we must explicitly write the defaults
    data[current_len] = 0; // pair_type = 0 (Fixed)
    data[current_len + 1..current_len + 9].copy_from_slice(&0u64.to_le_bytes()); // total_equity = 0

    msg!(
        "Pair account migrated to v2. Old size: {}, new size: {}",
        current_len,
        new_size
    );

    Ok(())
}

/// Migrate AccessControl account to v2 layout (add nav_authority + pending_nav_authority).
#[derive(Accounts)]
pub struct MigrateAccessControlV2<'info> {
    /// CHECK: We manually handle deserialization because the account may be in old layout.
    #[account(
        mut,
        seeds = [b"access_control"],
        bump,
    )]
    pub access_control: UncheckedAccount<'info>,

    /// The current access_authority must sign. We verify by reading the old layout.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn migrate_access_control_handler(
    ctx: Context<MigrateAccessControlV2>,
    nav_authority: Pubkey,
) -> Result<()> {
    let ac_info = ctx.accounts.access_control.to_account_info();
    let data = ac_info.try_borrow_data()?;
    let current_len = data.len();

    // Verify the signer is the access_authority by reading from the old layout
    // AccessControl layout: discriminator(8) + bump(1) + merkle_root(32) + is_whitelist_enabled(1)
    //   + vault_authority(32) + window_authority(32) + deposit_authority(32) + pair_authority(32)
    //   + unseal_authority(32) + access_authority(32) + ...
    // access_authority starts at offset: 8 + 1 + 32 + 1 + 32*5 = 202
    let access_authority_offset = 8 + 1 + 32 + 1 + (32 * 5);
    if current_len > access_authority_offset + 32 {
        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(&data[access_authority_offset..access_authority_offset + 32]);
        let access_authority = Pubkey::from(key_bytes);
        require!(
            access_authority == ctx.accounts.authority.key(),
            StakingError::InvalidAuthority
        );
    }
    drop(data);

    // New fields: nav_authority (32) + pending_nav_authority (Option<Pubkey> = 1 + 32 = 33) = 65 bytes
    let new_size = current_len + 65;

    // Transfer lamports from payer to account to cover additional rent
    let rent = Rent::get()?;
    let new_rent = rent.minimum_balance(new_size);
    let current_lamports = ac_info.lamports();
    if new_rent > current_lamports {
        let diff = new_rent - current_lamports;
        let payer = &ctx.accounts.authority;
        **payer.to_account_info().try_borrow_mut_lamports()? -= diff;
        **ac_info.try_borrow_mut_lamports()? += diff;
    }

    ac_info.realloc(new_size, false)?;

    let mut data = ac_info.try_borrow_mut_data()?;
    // Write nav_authority (32 bytes)
    data[current_len..current_len + 32].copy_from_slice(&nav_authority.to_bytes());
    // Write pending_nav_authority = None (Option<Pubkey>: 0 byte = None)
    data[current_len + 32] = 0; // None variant
    // The remaining 32 bytes of the Option are unused when None, but zero them for safety
    data[current_len + 33..current_len + 65].fill(0);

    msg!(
        "AccessControl migrated to v2. nav_authority: {}. Old size: {}, new size: {}",
        nav_authority,
        current_len,
        new_size
    );

    Ok(())
}
