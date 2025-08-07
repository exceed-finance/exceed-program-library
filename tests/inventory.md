# Inventory

Here is a list of the test cases we need.

1. creating authority
1. authority transfer
1. adding and managing guardians
1. sealing the program
1. unsealing the program
1. creating a pair
1. creating a pair with token program
1. creating a pair with token 22 program
1. creating metadata for a token program pair with mpl token metadata
1. creating metadata for a token 22 program with metadata pointer extension
1. creating a window
1. creating a window with the wrong authority
1. funding a window
1. funding a window with the wrong authority
1. requesting withdrawal before the start time of a window
1. requesting withdrawal after the end time of a window
1. cancelling a withdrawal request before the start time of a window
1. cancelling a withdrawal after the end time of a window
1. executing withdrawal
1. executing withdrawal with the wrong signer
1. restaking expired withdrawal
1. restaking expired withdrawal with the wrong authority
1. withdrawing from the pair base token account (vault withdraw)
1. vault withdraw with the wrong authority
1. time traveling to a year in the future to make sure the apy calc is correct
1. updating pair limits
1. updating pair yield
1. updating pair apy
1. staking and time traveling to make sure the updated apy calc is correct
1. staking and withdrawing with a pair with no yield
1. closing withdrawal window
1. withdrawing lst fees
1. swapping between two LST tokens with the same base token
1. attempting to swap with zero quantity (should fail with InvalidQuantity error)
1. attempting to swap with mismatched base token mints (should fail with BaseTokenMintMismatch error)
1. attempting to swap when the program is sealed (should fail)
1. attempting to swap with invalid merkle proof when whitelist is enabled (should fail)
1. attempting a swap that would exceed destination pair deposit cap (should fail)
1. swapping with different fee configurations to verify fee calculations
1. updating the merkle root successfully
1. enabling the whitelist successfully
1. disabling the whitelist successfully
1. attempting to update whitelist with the wrong authority (should fail)
1. attempting to update whitelist when the program is sealed (should fail)
1. staking with whitelist enabled and valid merkle proof
1. staking with whitelist enabled and invalid merkle proof (should fail)
1. staking with whitelist disabled (should succeed regardless of merkle proof)
1. swapping between LSTs with different exchange rates to verify correct calculations
1. testing the impact of time on exchange rates during swaps (time travel to verify calculations)
1. testing staking, swapping, and withdrawing with minimum and maximum possible values
1. testing operations with token accounts that have different decimals
