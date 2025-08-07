import { Pda, PublicKey, Umi } from "@metaplex-foundation/umi";
export declare const findAccessControlPda: (umi: Umi) => Pda;
export declare const findLstPda: (umi: Umi, symbol: string) => Pda;
export declare const findPairPda: (umi: Umi, base: PublicKey, lst: PublicKey) => Pda;
export declare const findWithdrawalWindowPda: (umi: Umi, pair: PublicKey, startTime: number | bigint) => Pda;
export declare const findWithdrawalRequestPda: (umi: Umi, withdrawalWindow: PublicKey, staker: PublicKey) => Pda;
