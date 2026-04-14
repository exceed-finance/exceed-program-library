use crate::{error::StakingError, types::AuthorityType};
use anchor_lang::prelude::*;
use solana_program;

#[account]
pub struct AccessControl {
    pub bump: u8,
    // Whitelist control
    pub merkle_root: [u8; 32],
    pub is_whitelist_enabled: bool,

    // Core authorities
    pub vault_authority: Pubkey,
    pub window_authority: Pubkey,
    pub deposit_authority: Pubkey,
    pub pair_authority: Pubkey,
    pub unseal_authority: Pubkey,
    pub access_authority: Pubkey,
    pub nav_authority: Pubkey,

    // Price Info
    pub sol_usdc_feed_id: [u8; 32],

    // Emergency control system
    pub guardians: [Option<Pubkey>; 5],
    pub is_sealed: bool,

    // Authority transfer system
    pub pending_vault_authority: Option<Pubkey>,
    pub pending_window_authority: Option<Pubkey>,
    pub pending_deposit_authority: Option<Pubkey>,
    pub pending_pair_authority: Option<Pubkey>,
    pub pending_unseal_authority: Option<Pubkey>,
    pub pending_access_authority: Option<Pubkey>,
    pub pending_nav_authority: Option<Pubkey>,
}

impl AccessControl {
    pub fn get_authority(&self, authority_type: &AuthorityType) -> Pubkey {
        match authority_type {
            AuthorityType::Vault => self.vault_authority,
            AuthorityType::Window => self.window_authority,
            AuthorityType::Deposit => self.deposit_authority,
            AuthorityType::Pair => self.pair_authority,
            AuthorityType::Unseal => self.unseal_authority,
            AuthorityType::Access => self.access_authority,
            AuthorityType::Nav => self.nav_authority,
        }
    }

    pub fn get_pending_authority(&self, authority_type: &AuthorityType) -> Option<Pubkey> {
        match authority_type {
            AuthorityType::Vault => self.pending_vault_authority,
            AuthorityType::Window => self.pending_window_authority,
            AuthorityType::Deposit => self.pending_deposit_authority,
            AuthorityType::Pair => self.pending_pair_authority,
            AuthorityType::Unseal => self.pending_unseal_authority,
            AuthorityType::Access => self.pending_access_authority,
            AuthorityType::Nav => self.pending_nav_authority,
        }
    }

    pub fn set_pending_authority(&mut self, authority_type: &AuthorityType, new_authority: Pubkey) {
        match authority_type {
            AuthorityType::Vault => self.pending_vault_authority = Some(new_authority),
            AuthorityType::Window => self.pending_window_authority = Some(new_authority),
            AuthorityType::Deposit => self.pending_deposit_authority = Some(new_authority),
            AuthorityType::Pair => self.pending_pair_authority = Some(new_authority),
            AuthorityType::Unseal => self.pending_unseal_authority = Some(new_authority),
            AuthorityType::Access => self.pending_access_authority = Some(new_authority),
            AuthorityType::Nav => self.pending_nav_authority = Some(new_authority),
        }
    }

    pub fn complete_authority_transfer(
        &mut self,
        authority_type: &AuthorityType,
        new_authority: Pubkey,
    ) {
        match authority_type {
            AuthorityType::Vault => {
                self.vault_authority = new_authority;
                self.pending_vault_authority = None;
            }
            AuthorityType::Window => {
                self.window_authority = new_authority;
                self.pending_window_authority = None;
            }
            AuthorityType::Deposit => {
                self.deposit_authority = new_authority;
                self.pending_deposit_authority = None;
            }
            AuthorityType::Pair => {
                self.pair_authority = new_authority;
                self.pending_pair_authority = None;
            }
            AuthorityType::Unseal => {
                self.unseal_authority = new_authority;
                self.pending_unseal_authority = None;
            }
            AuthorityType::Access => {
                self.access_authority = new_authority;
                self.pending_access_authority = None;
            }
            AuthorityType::Nav => {
                self.nav_authority = new_authority;
                self.pending_nav_authority = None;
            }
        }
    }

    pub fn clear_pending_authority(&mut self, authority_type: &AuthorityType) {
        match authority_type {
            AuthorityType::Vault => self.pending_vault_authority = None,
            AuthorityType::Window => self.pending_window_authority = None,
            AuthorityType::Deposit => self.pending_deposit_authority = None,
            AuthorityType::Pair => self.pending_pair_authority = None,
            AuthorityType::Unseal => self.pending_unseal_authority = None,
            AuthorityType::Access => self.pending_access_authority = None,
            AuthorityType::Nav => self.pending_nav_authority = None,
        }
    }

    pub fn verify_unsealed(&self) -> Result<()> {
        require!(!self.is_sealed, StakingError::ProgramSealed);
        Ok(())
    }

    pub fn verify_guardian(&self, key: Pubkey) -> Result<()> {
        require!(
            self.guardians.contains(&Some(key)),
            StakingError::InvalidGuardian
        );
        Ok(())
    }

    pub fn verify_authority(
        &self,
        authority_type: &AuthorityType,
        authority_pubkey: &Pubkey,
    ) -> Result<()> {
        let expected = self.get_authority(authority_type);
        require!(
            &expected == authority_pubkey,
            StakingError::InvalidAuthority,
        );

        Ok(())
    }

    pub fn create_leaf_from_pubkey(pubkey: &Pubkey) -> [u8; 32] {
        let mut leaf = [0u8; 32];
        let pubkey_bytes = pubkey.to_bytes();
        leaf[..32].copy_from_slice(&pubkey_bytes);
        leaf
    }

    pub fn check_whitelist_access(
        &self,
        user: &Pubkey,
        proof: Option<Vec<[u8; 32]>>,
    ) -> Result<()> {
        if !self.is_whitelist_enabled {
            return Ok(());
        }

        let proof = proof.ok_or(StakingError::MerkleProofRequired)?;
        let leaf: solana_program::keccak::Hash =
            solana_program::keccak::hashv(&[user.key().to_string().as_bytes()]);

        self.verify_merkle_proof(proof, &leaf.0)
    }

    pub fn verify_merkle_proof(&self, proof: Vec<[u8; 32]>, leaf: &[u8; 32]) -> Result<()> {
        // NOTE: Verifying merkle trees this way only works if the leaf nodes are pre-sorted.
        let mut computed_hash = *leaf;
        for proof_element in proof.iter() {
            if computed_hash <= *proof_element {
                computed_hash = solana_program::keccak::hashv(&[&computed_hash, proof_element]).0
            } else {
                computed_hash = solana_program::keccak::hashv(&[proof_element, &computed_hash]).0;
            }
        }

        // Check if the computed hash matches the stored Merkle root
        if computed_hash == self.merkle_root {
            Ok(())
        } else {
            return err!(StakingError::AddressNotFoundInAllowedList);
        }
    }
}
