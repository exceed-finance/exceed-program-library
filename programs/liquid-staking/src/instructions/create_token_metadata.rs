use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
use mpl_token_metadata::{
    instructions::CreateV1CpiBuilder, types::TokenStandard, ID as MPL_TOKEN_METADATA_ID,
};
use solana_program::sysvar::SysvarId;

use crate::{
    error::StakingError,
    state::{AccessControl, Pair},
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateTokenMetadataParams {
    pub name: String,
    pub uri: String,
}

#[derive(Accounts)]
pub struct CreateTokenMetadata<'info> {
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

    #[account(
        seeds = [
            b"pair",
            pair.base_token_mint.key().as_ref(),
            lst_mint.key().as_ref()
        ],
        bump
    )]
    pub pair: Box<Account<'info, Pair>>,

    #[account(
        mut,
        seeds = [
            b"lst_mint",
            pair.lst_symbol.as_ref()
        ],
        bump = pair.lst_mint_bump
    )]
    pub lst_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Metadata account that will be created
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: We check this against the token metadata program ID.
    pub token_metadata_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: Instructions::check_id
    pub sysvar_instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateTokenMetadata>, params: CreateTokenMetadataParams) -> Result<()> {
    ctx.accounts.access_control.verify_unsealed()?;

    let CreateTokenMetadata {
        pair,
        metadata,
        lst_mint,
        pair_authority,
        token_program,
        token_metadata_program,
        system_program,
        sysvar_instructions,
        ..
    } = ctx.accounts;

    require!(
        token_metadata_program.key() == MPL_TOKEN_METADATA_ID,
        StakingError::InvalidMetadataProgram
    );

    require!(
        Instructions::check_id(&sysvar_instructions.key(),),
        StakingError::InvalidSysvarInstructions
    );

    let lst_mint_seeds = &[
        b"lst_mint",
        pair.lst_symbol.as_bytes(),
        &[pair.lst_mint_bump],
    ];

    CreateV1CpiBuilder::new(&token_metadata_program.to_account_info())
        .mint(&lst_mint.to_account_info(), true)
        .metadata(&metadata.to_account_info())
        .name(params.name)
        .symbol(pair.lst_symbol.clone())
        .uri(params.uri)
        .token_standard(TokenStandard::Fungible)
        .seller_fee_basis_points(0)
        .authority(&lst_mint.to_account_info())
        .update_authority(&pair_authority.to_account_info(), true)
        .payer(&pair_authority.to_account_info())
        .spl_token_program(Some(&token_program.to_account_info()))
        .system_program(&system_program.to_account_info())
        .sysvar_instructions(&sysvar_instructions.to_account_info())
        .invoke_signed(&[lst_mint_seeds])?;

    msg!("Token metadata created successfully");
    Ok(())
}
