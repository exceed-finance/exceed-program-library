// Export generated clients as namespaces to avoid name conflicts
import { PublicKey } from '@metaplex-foundation/umi';
import * as EarlyPurchase from './generated/early_purchase';
import * as LiquidStaking from './generated/liquid_staking';

export { EarlyPurchase, LiquidStaking };

export const DEV_LIQUID_STAKING_PROGRAM_ID =
    'p4riTyfkW74xrFPbZyxw4UhmsYAyRdg8nc27CvQBmfD' as PublicKey<'p4riTyfkW74xrFPbZyxw4UhmsYAyRdg8nc27CvQBmfD'>;

// Export utilities
export * from './utils/merkle';
export * from './utils/rateCalculations';

// Export PDAs
export * from './utils/pda';
