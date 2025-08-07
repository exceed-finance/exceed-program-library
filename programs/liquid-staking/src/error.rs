use anchor_lang::error_code;

#[error_code]
pub enum StakingError {
    #[msg("Invalid LST symbol")]
    InvalidSymbol = 0,

    #[msg("Invalid first admin")]
    InvalidFirstAdmin = 1,

    #[msg("Invalid admin")]
    InvalidAdmin = 2,

    /// Invalid yield rate provided
    #[msg("Invalid yield rate provided")]
    InvalidYieldRate = 3,

    /// Maximum yield rate exceeded
    #[msg("Maximum yield rate exceeded")]
    MaxYieldRateExceeded = 4,

    /// Invalid program data account
    #[msg("Invalid program data account")]
    InvalidProgramDataAccount = 5,

    /// Invalid upgrade authority
    #[msg("Invalid upgrade authority")]
    InvalidProgramUpgradeAuthority = 6,

    #[msg("Invalid authority for operation")]
    InvalidAuthority = 7,

    #[msg("A pending authority transfer already exists")]
    PendingAuthorityExists = 8,

    #[msg("No pending authority transfer exists")]
    NoPendingAuthority = 9,

    #[msg("Invalid pending authority")]
    InvalidPendingAuthority = 10,

    #[msg("Calculation overflow occurred")]
    CalculationOverflow = 100,

    #[msg("Deposit cap exceeded")]
    DepositCapExceeded = 200,

    #[msg("Authority token already exists for this pair")]
    AuthorityTokenAlreadyExists = 201,

    #[msg("Invalid quantity")]
    InvalidQuantity = 300,

    #[msg("Window is not currently active")]
    WindowNotActive = 400,

    #[msg("Cannot execute withdrawal before delay period")]
    WithdrawalTooEarly = 401,

    #[msg("Window has expired")]
    WindowExpired = 402,

    #[msg("No withdrawal request found")]
    NoWithdrawalRequest = 403,

    #[msg("Window already exists for this period")]
    WindowAlreadyExists = 404,

    #[msg("Only authority can create windows")]
    UnauthorizedWindowCreation = 405,

    #[msg("Window not funded")]
    WindowNotFunded = 406,

    #[msg("Withdrawal request already exists for this window")]
    WithdrawalRequestExists = 407,

    #[msg("Withdrawal request already executed")]
    WithdrawalAlreadyExecuted = 408,

    #[msg("Window withdrawal limit exceeded")]
    WindowWithdrawalLimitExceeded = 409,

    #[msg("Withdrawal has expired")]
    WithdrawalExpired = 410,

    #[msg("Withdrawal has not expired yet")]
    WithdrawalNotExpired = 411,

    #[msg("Only vault withdraw authority can withdraw funds")]
    UnauthorizedVaultWithdraw = 412,

    #[msg("Only window authority can manage withdrawal windows")]
    UnauthorizedWindowOperation = 413,

    #[msg("Only pair authority can manage pairs")]
    UnauthorizedPairOperation = 414,

    #[msg("Insufficient funds to fund withdrawal window")]
    InsufficientFundsForWindow = 415,

    #[msg("No pending authority transfer to cancel")]
    NoPendingAuthorityToCancel = 416,

    #[msg("End time must be after start time")]
    InvalidWindowTimes = 417,

    #[msg("Window times cannot be in the past")]
    WindowTimesInPast = 418,

    #[msg("Source and destination pairs must share the same base token mint")]
    BaseTokenMintMismatch = 419,

    #[msg("Program is currently sealed")]
    ProgramSealed = 420,

    #[msg("Invalid guardian")]
    InvalidGuardian = 421,

    #[msg("Invalid unseal authority")]
    InvalidUnsealAuthority = 422,

    #[msg("No guardian slots available")]
    NoGuardianSlots = 423,

    #[msg("Guardian not found")]
    GuardianNotFound = 424,

    #[msg("Cannot close window with active withdrawal requests")]
    WindowHasActiveRequests = 425,

    #[msg("Address not found in allowed list")]
    AddressNotFoundInAllowedList = 426,

    #[msg("Invalid fee percentage")]
    InvalidFeePercentage = 427,

    #[msg("Insufficient fee balance")]
    InsufficientFeeBalance = 428,

    #[msg("Invalid Metadata Account")]
    InvalidMetadata = 429,

    #[msg("Merkle proof required when whitelist is enabled")]
    MerkleProofRequired = 430,

    #[msg("Earliest withdrawal time must be after end time")]
    InvalidWithdrawalTime = 431,

    #[msg("Expiration time must be after earliest withdrawal time")]
    InvalidExpirationTime = 432,

    #[msg("Cannot fund window while it's still active")]
    WindowStillActive = 433,

    #[msg("Invalid withdrawal window")]
    InvalidWithdrawalWindow = 434,

    #[msg("Cannot cancel withdrawal request outside of active window")]
    WithdrawalCancellationNotAllowed = 435,

    #[msg("Window already funded")]
    WindowAlreadyFunded = 436,

    #[msg("Invalid Metadata Program")]
    InvalidMetadataProgram = 437,

    #[msg("Invalid Sysvar Instructions")]
    InvalidSysvarInstructions = 438,

    #[msg("Guardian already exists")]
    GuardianAlreadyExists = 439,

    #[msg("Default pubkey not allowed")]
    DefaultPubkeyNotAllowed = 440,

    #[msg("Invalid Minimum Deposit")]
    InvalidMinimumDeposit = 441,

    #[msg("Cannot receive more LSTs than input tokens")]
    InvalidMigrationOutput = 442,
}
