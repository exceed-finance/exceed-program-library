# Parity Liquid Staking Program

This program implements liquid staking functionality, allowing users to stake tokens and receive liquid staking tokens (LST) in return. Below are the program's instructions listed in their recommended order of use.

## Authority Management Instructions

### 1. create_authority_proof

This instruction must be called first to establish the authority structure for the program. It creates an Authority Proof account that holds the public keys for each zone of authority:
- Vault Withdraw Authority
- Window Authority
- Deposit Authority
- Pair Authority

Only one Authority Proof account can exist, and it must be created by the designated first admin.

### 2. initiate_authority_transfer

After the Authority Proof account is created, an authority can initiate the transfer of their specific authority privilege to another address. For example, if pubkey X is the Pair Authority, they can designate a new Pair Authority by calling this instruction with their authority type and the new address.

### 3. accept_authority_transfer

Once an authority transfer has been initiated, the designated new authority must call this instruction to accept and complete the transfer of authority.

## Pair Setup and Management

### 4. create_pair

Creates a new trading pair between a base token and its corresponding LST (Liquid Staking Token). This instruction:
- Initializes the pair account with yield parameters
- Creates the LST mint with matching decimals
- Sets up token accounts for the pair
- Establishes initial exchange rates

### 5. update_pair_yield

Allows the pair authority to update yield parameters for a pair, including:
- APR rate
- Interval duration
- Exchange rates
- Deposit caps

## Staking Operations

### 6. stake

Core staking function that allows users to:
- Deposit base tokens into the pair's vault
- Receive LST tokens based on the current exchange rate
- Automatically creates user LST token account if needed

## Withdrawal Management

### 7. create_withdrawal_window

Creates a time window during which users can request withdrawals. Parameters include:
- Start and end dates
- Withdrawal delay period
- Maximum withdrawal amount
- Expiration date

### 8. fund_withdrawal_window

Provides the withdrawal window with base tokens to fulfill withdrawal requests. Must be called after the window is created and before withdrawals can be executed.

### 9. request_withdraw

Allows users to request withdrawals during an active withdrawal window:
- Burns user's LST tokens
- Creates withdrawal request account
- Records amount to be withdrawn

### 10. execute_withdraw

Executes approved withdrawal requests after the withdrawal delay period has passed:
- Transfers base tokens to user
- Updates withdrawal window totals
- Closes the withdrawal request account

### 11. restake_expired_withdrawal

Handles expired withdrawal requests by restaking the tokens:
- Can be called after the expiration date
- Converts expired withdrawals back into LST
- Updates withdrawal window state

## Administrative Operations

### 12. vault_withdraw

Utility function for vault management that allows the vault authority to withdraw specific amounts of base tokens
