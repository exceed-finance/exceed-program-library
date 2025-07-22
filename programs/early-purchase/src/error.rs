use anchor_lang::prelude::*;

#[error_code]
pub enum EarlyPurchaseError {
    #[msg("The maximum amount of tokens have been purchased")]
    TotalPurchaseCountReached,

    #[msg("You have purchased the maximum amount of tokens per user")]
    UserPurchaseCountReached,

    #[msg("Tokens cannot be purchased until the start timestamp is reached")]
    PurchaseBeforeStart,

    #[msg("Tokens cannot be purchased after the end timestamp has been reached")]
    PurchaseAfterEnd,

    #[msg("Tokens cannot be purchased while the sale is frozen")]
    PurchaseDuringFreeze,

    #[msg("The guardian signer must be provided")]
    PurchaseWithoutGuardianSigner,

    #[msg("The guardian must be provided")]
    PurchaseWithoutGuardian,

    #[msg("The token accounts must be provided")]
    TokenPaymentWithoutTokenAccounts,

    #[msg("The token accounts must be provided")]
    SolPaymentWithoutPriceFeed,

    #[msg("Cannot deposit before end")]
    DepositBeforeEnd,

    #[msg("Cannot withdraw funds before sale has ended")]
    WithdrawBeforeEnd,

    #[msg("The guardian must have withdraw_funds permission")]
    WithdrawWithoutPermission,

    #[msg("Insufficient funds to withdraw")]
    InsufficientFundsToWithdraw,

    #[msg("Only the sale creator or their guardian can withdraw funds")]
    WithdrawNotCreator,

    #[msg("Arithmetic Overflow")]
    AritmeticOverflow,

    #[msg("Invalid Price")]
    InvalidPrice,

    #[msg("Invalid sale timeframe: end time must be after start time")]
    InvalidSaleTimeframe,

    #[msg("Sale duration is too short")]
    SaleDurationTooShort,

    #[msg("Start time is too far in the future")]
    StartTimeTooFarInFuture,

    #[msg(
        "Invalid token amounts: max_tokens_per_user must be less than or equal to max_tokens_total"
    )]
    InvalidTokenAmounts,

    #[msg("Invalid payment amount: must be greater than zero")]
    InvalidPaymentAmount,

    #[msg("Invalid price feed age: must be greater than zero")]
    InvalidPriceFeedAge,

    #[msg("Invalid sale ID: exceeds maximum allowed value")]
    InvalidSaleId,

    #[msg("Uninitialized mint account")]
    UninitializedMint,

    #[msg("Ended too early")]
    EarlyEnd,

    #[msg("Sale cannot be updated after start")]
    UpdateAfterStart,

    #[msg("Sale cannot be frozen after its conclusion")]
    FreezeAfterEnd,

    #[msg("Slippage has been exceeded")]
    SlippageExceeded,

    #[msg("Guardian lacks required permission for this operation")]
    GuardianMissingPermission,

    #[msg("No tokens available to redeem")]
    NothingToRedeem,

    #[msg("Arithmetic calculation resulted in overflow")]
    CalculationOverflow,

    #[msg("Arithmetic calculation resulted in underflow")]
    CalculationUnderflow,

    #[msg("Base cost calculation resulted in overflow")]
    BaseCostCalculationOverflow,

    #[msg("Invalid admin public key format")]
    InvalidAdminPubkey,

    #[msg("Invalid price feed hex string")]
    InvalidPriceFeedHex,

    #[msg("Missing required token account")]
    MissingTokenAccount,

    #[msg("Missing price update account")]
    MissingPriceUpdate,

    #[msg("Invalid timeframe calculation")]
    InvalidTimeframeCalculation,
}
