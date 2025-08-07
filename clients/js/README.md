# Parity Program Library Clients

JavaScript clients for Parity Program Library.

## Overview

This package provides JavaScript/TypeScript clients for interacting with the Parity Program Library Solana programs:

- Early Purchase
- Liquid Staking

It also includes utility functions for:
- Merkle tree operations
- Rate calculations
- Program Derived Address (PDA) helpers

## Installation

```bash
npm install @parity/program-library-clients
```

## Usage

```typescript
import { EarlyPurchase, LiquidStaking, calculateExchangeRate } from '@parity/program-library-clients';

// Use the early purchase client
// Example: EarlyPurchase.depositTokens(...)

// Use the liquid staking client
// Example: LiquidStaking.stake(...)

// Use utility functions
// Example: calculateExchangeRate(...)
```

## Development Notes

This is a preliminary version of the package. There are some TypeScript errors in the auto-generated code that need to be addressed in future versions:

### Known Issues

1. **VerificationLevel Type Error**: There's a TypeScript error in the auto-generated `verificationLevel.ts` file related to the Pyth price feed verification level. This issue occurs because the auto-generated code attempts to spread an array into an object, which creates a type mismatch. This will be fixed in a future version of the code generator.

   The error doesn't affect runtime functionality, but it does cause TypeScript compilation warnings.

## License

ISC
