use anchor_lang::prelude::*;

use crate::error::StakingError;

/// Fix AccessControl migration: write nav_authority at the correct Borsh offset.
///
/// The AccessControl account has padding between the end of Borsh data (~278 bytes)
/// and the allocated account size (630+ bytes). The new fields must be written at
/// the Borsh data boundary, not at the end of the allocated space.
///
/// This instruction:
/// 1. Finds the exact Borsh end position by parsing through variable-length Options
/// 2. Writes nav_authority (32 bytes) at that position
/// 3. Writes pending_nav_authority = None (1 byte) right after
/// 4. Cleans up any incorrectly placed data from a previous migration attempt
#[derive(Accounts)]
pub struct MigrateAccessControlV2<'info> {
    /// CHECK: We manually parse this account's raw bytes.
    /// PDA verified via seeds.
    #[account(
        mut,
        seeds = [b"access_control"],
        bump,
    )]
    pub access_control: UncheckedAccount<'info>,

    /// The current access_authority must sign.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn migrate_access_control_handler(
    ctx: Context<MigrateAccessControlV2>,
    nav_authority: Pubkey,
) -> Result<()> {
    let ac_info = ctx.accounts.access_control.to_account_info();
    let mut data = ac_info.try_borrow_mut_data()?;
    let account_len = data.len();

    // Verify the signer is the access_authority at fixed offset 202
    // Layout: disc(8) + bump(1) + merkle_root(32) + is_whitelist_enabled(1) + 5 pubkeys(160) = 202
    let ac_offset = 8 + 1 + 32 + 1 + (32 * 5); // = 202
    require!(
        account_len > ac_offset + 32,
        StakingError::InvalidAuthority
    );
    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&data[ac_offset..ac_offset + 32]);
    let access_authority = Pubkey::from(key_bytes);
    require!(
        access_authority == ctx.accounts.authority.key(),
        StakingError::InvalidAuthority
    );

    // Find the exact Borsh end position by parsing variable-length fields.
    // Fixed fields up to sol_usdc_feed_id:
    // disc(8) + bump(1) + merkle_root(32) + is_whitelist_enabled(1) + 6 pubkeys(192) + feed_id(32) = 266
    let mut pos: usize = 266;

    // Parse guardians: [Option<Pubkey>; 5]
    for _i in 0..5 {
        require!(pos < account_len, StakingError::CalculationOverflow);
        if data[pos] == 0 {
            pos += 1; // None
        } else {
            pos += 33; // Some(Pubkey)
        }
    }

    // is_sealed: bool (1 byte)
    pos += 1;

    // Parse 6 pending authorities: Option<Pubkey> each
    for _i in 0..6 {
        require!(pos < account_len, StakingError::CalculationOverflow);
        if data[pos] == 0 {
            pos += 1; // None
        } else {
            pos += 33; // Some(Pubkey)
        }
    }

    msg!("Borsh data ends at byte {}. Account size: {}", pos, account_len);

    // Verify there's enough space for the new fields (32 + 1 = 33 bytes)
    require!(
        pos + 33 <= account_len,
        StakingError::CalculationOverflow
    );

    // Write nav_authority at the correct Borsh position
    data[pos..pos + 32].copy_from_slice(&nav_authority.to_bytes());
    pos += 32;

    // Write pending_nav_authority = None
    data[pos] = 0;
    pos += 1;

    // Clean up any incorrectly placed data from previous migration attempt
    // (bytes 630+ may have stale data)
    for i in pos..account_len {
        data[i] = 0;
    }

    msg!(
        "AccessControl migrated to v2. nav_authority: {}. Borsh end: {}",
        nav_authority,
        pos
    );

    Ok(())
}

/// Migrate Pair account: write pair_type + total_equity at the correct Borsh offset.
///
/// Similar to AccessControl, the Pair account has padding after Borsh data.
/// We find the Borsh end and write the new fields there.
#[derive(Accounts)]
pub struct MigratePairV2<'info> {
    /// CHECK: We manually parse access_control raw bytes to verify pair_authority.
    #[account(
        seeds = [b"access_control"],
        bump,
    )]
    pub access_control: UncheckedAccount<'info>,

    #[account(mut)]
    pub pair_authority: Signer<'info>,

    /// CHECK: We manually handle this account's raw bytes.
    #[account(mut)]
    pub pair: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn migrate_pair_handler(ctx: Context<MigratePairV2>) -> Result<()> {
    // Verify pair_authority from access_control raw bytes
    // pair_authority is at offset: disc(8) + bump(1) + merkle_root(32) + whitelist(1) + 3 pubkeys(96) = 138
    let ac_info = ctx.accounts.access_control.to_account_info();
    let ac_data = ac_info.try_borrow_data()?;
    let pa_offset = 8 + 1 + 32 + 1 + (32 * 3); // = 138
    require!(
        ac_data.len() > pa_offset + 32,
        StakingError::InvalidAuthority
    );
    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&ac_data[pa_offset..pa_offset + 32]);
    let pair_authority = Pubkey::from(key_bytes);
    require!(
        pair_authority == ctx.accounts.pair_authority.key(),
        StakingError::InvalidAuthority
    );
    drop(ac_data);

    let pair_info = ctx.accounts.pair.to_account_info();
    let mut data = pair_info.try_borrow_mut_data()?;
    let account_len = data.len();

    // Parse Pair Borsh layout to find end position.
    // Pair fields (Borsh):
    // disc(8) + pair_bump(1) + lst_mint_bump(1) + base_token_mint(32) + base_mint_decimals(1)
    // + lst_mint(32) + lst_mint_decimals(1) + lst_symbol(4 + len bytes, Borsh String)
    // + interval_apr_rate(8) + seconds_per_interval(4) + initial_exchange_rate(8)
    // + last_yield_change_exchange_rate(8) + last_yield_change_timestamp(8)
    // + deposit_cap(8) + minimum_deposit(8)
    // + stake_fee_bps(2) + swap_fee_bps(2) + withdraw_fee_bps(2)

    let mut pos: usize = 8; // skip discriminator
    pos += 1; // pair_bump
    pos += 1; // lst_mint_bump
    pos += 32; // base_token_mint
    pos += 1; // base_mint_decimals
    pos += 32; // lst_mint
    pos += 1; // lst_mint_decimals

    // lst_symbol: Borsh String = 4-byte length + UTF-8 bytes
    require!(pos + 4 <= account_len, StakingError::CalculationOverflow);
    let str_len = u32::from_le_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]) as usize;
    pos += 4 + str_len;

    pos += 8; // interval_apr_rate
    pos += 4; // seconds_per_interval
    pos += 8; // initial_exchange_rate
    pos += 8; // last_yield_change_exchange_rate
    pos += 8; // last_yield_change_timestamp
    pos += 8; // deposit_cap
    pos += 8; // minimum_deposit
    pos += 2; // stake_fee_bps
    pos += 2; // swap_fee_bps
    pos += 2; // withdraw_fee_bps

    msg!("Pair Borsh data ends at byte {}. Account size: {}", pos, account_len);

    // Verify enough space for new fields (1 + 8 = 9 bytes)
    require!(
        pos + 9 <= account_len,
        StakingError::CalculationOverflow
    );

    // Write pair_type = 0 (Fixed)
    data[pos] = 0;
    pos += 1;

    // Write total_equity = 0
    data[pos..pos + 8].copy_from_slice(&0u64.to_le_bytes());
    pos += 8;

    // Clean up any trailing garbage
    for i in pos..account_len {
        data[i] = 0;
    }

    msg!("Pair migrated to v2. Borsh end: {}", pos);

    Ok(())
}
