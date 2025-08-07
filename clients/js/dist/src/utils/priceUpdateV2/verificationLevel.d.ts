import { GetDataEnumKind, GetDataEnumKindContent, Serializer } from '@metaplex-foundation/umi/serializers';
/**
 * Pyth price updates are bridged to all blockchains via Wormhole.
 * Using the price updates on another chain requires verifying the signatures of the Wormhole guardians.
 * The usual process is to check the signatures for two thirds of the total number of guardians, but this can be cumbersome on Solana because of the transaction size limits,
 * so we also allow for partial verification.
 *
 * This enum represents how much a price update has been verified:
 * - If `Full`, we have verified the signatures for two thirds of the current guardians.
 * - If `Partial`, only `num_signatures` guardian signatures have been checked.
 *
 * # Warning
 * Using partially verified price updates is dangerous, as it lowers the threshold of guardians that need to collude to produce a malicious price update.
 */
export type VerificationLevel = {
    __kind: 'Partial';
    numSignatures: number;
} | {
    __kind: 'Full';
};
export type VerificationLevelArgs = VerificationLevel;
export declare function getVerificationLevelSerializer(): Serializer<VerificationLevelArgs, VerificationLevel>;
export declare function verificationLevel(kind: 'Partial', data: GetDataEnumKindContent<VerificationLevelArgs, 'Partial'>): GetDataEnumKind<VerificationLevelArgs, 'Partial'>;
export declare function verificationLevel(kind: 'Full'): GetDataEnumKind<VerificationLevelArgs, 'Full'>;
export declare function isVerificationLevel<K extends VerificationLevel['__kind']>(kind: K, value: VerificationLevel): value is VerificationLevel & {
    __kind: K;
};
