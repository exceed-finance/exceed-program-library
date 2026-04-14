use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum AuthorityType {
    Vault,   // For withdrawing funds from the program
    Window,  // For creating withdrawal windows
    Deposit, // For deposits
    Pair,    // For creating pairs and updating yield
    Unseal,  // For unsealing program and managing guardians
    Access,
    Nav,     // For submitting NAV updates to variable pairs
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum ConversionDirection {
    LstToBase,
    BaseToLst,
}
