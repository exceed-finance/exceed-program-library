import { LiquidStaking } from "../";
export declare const SECONDS_PER_YEAR: number;
export declare const PRECISION = 1000000000000n;
/**
 * Calculates the exchange rate based on elapsed time and interval rate.
 *
 * @param lastYieldChangeTimestamp - Timestamp of the last yield change
 * @param currentTimestamp - Current timestamp
 * @param intervalRate - Rate per interval
 * @param lastYieldChangeExchangeRate - Exchange rate at the last yield change
 * @param intervalSeconds - Duration of each interval in seconds
 * @returns The calculated exchange rate as a bigint
 */
export declare function calculateExchangeRate(lastYieldChangeTimestamp: number | bigint, currentTimestamp: number | bigint, intervalRate: number | bigint, lastYieldChangeExchangeRate: number | bigint, intervalSeconds: number | bigint): bigint;
/**
 * Calculates the interval rate needed to achieve a target annual yield with high precision.
 * This function uses the exact compound interest formula to avoid approximation errors.
 *
 * @param targetApyBps - Target annual yield in basis points (e.g., 500 for 5%)
 * @param intervalSeconds - Duration of each interval in seconds
 * @returns The interval rate value to use in the Pair struct
 */
export declare function calculateIntervalRateFromApy(targetApyBps: number | bigint, intervalSeconds: number | bigint): bigint;
/**
 * This function calculates the annual yield in basis points (bps) based on the interval rate and the interval duration in seconds.
 * Uses BigInt for all calculations to avoid floating-point errors.
 * Implements the exact compound interest formula (1 + r)^n - 1 for maximum accuracy.
 *
 * @param intervalRateParam - The interval rate, adjusted for precision.
 * @param intervalSeconds - The duration of each interval in seconds.
 * @returns The calculated annual yield in basis points (bps) as a BigInt.
 */
export declare function calculateAnnualYieldBps(intervalRateParam: number | bigint, intervalSeconds: number | bigint): bigint;
/**
 * Verifies that the calculated interval rate produces the expected APY.
 * This is useful for validating the precision of our calculations.
 * Uses BigInt for calculations but converts to number for logging.
 *
 * @param intervalRate - The calculated interval rate
 * @param targetApyBps - The target APY in basis points
 * @param intervalSeconds - The interval duration in seconds
 * @returns An object containing the target APY, actual APY, and error values
 */
export declare function verifyIntervalRate(intervalRate: bigint, targetApyBps: number | bigint, intervalSeconds: number | bigint): {
    targetApyBps: bigint;
    actualApyBps: bigint;
    errorBps: bigint;
    errorPercentage: string;
};
/**
 * Parameters required for yield calculations
 */
export interface YieldParams {
    lastYieldChangeTimestamp: number | bigint;
    lastYieldChangeExchangeRate: number | bigint;
    intervalAprRate: number | bigint;
    secondsPerInterval: number | bigint;
}
/**
 * Calculates the current LST exchange rate based on the pair's yield parameters
 *
 * @param pair - The yield parameters
 * @param currentTimestamp - The current timestamp
 * @returns The calculated exchange rate
 */
export declare function calculateLstExchangeRate(pair: YieldParams, currentTimestamp: number | bigint): bigint;
/**
 * Calculates the amount of LST tokens based on base token amount and exchange rate.
 * This function implements the BaseToLst conversion direction from the Rust code.
 * Formula: (amount * PRECISION) / exchange_rate, adjusted for decimal differences
 *
 * @param baseAmount - The amount of base tokens
 * @param exchangeRate - The current exchange rate
 * @param baseDecimals - The number of decimals for the base token
 * @param lstDecimals - The number of decimals for the LST token
 * @returns The calculated LST token amount
 */
export declare function calculateLstAmount(baseAmount: number | bigint, exchangeRate: number | bigint, baseDecimals?: number, lstDecimals?: number): bigint;
/**
 * Calculates the amount of base tokens based on LST token amount and exchange rate.
 * This function implements the LstToBase conversion direction from the Rust code.
 * Formula: (amount * exchange_rate) / PRECISION, adjusted for decimal differences
 *
 * @param lstAmount - The amount of LST tokens
 * @param exchangeRate - The current exchange rate
 * @param baseDecimals - The number of decimals for the base token
 * @param lstDecimals - The number of decimals for the LST token
 * @returns The calculated base token amount
 */
export declare function calculateBaseAmount(lstAmount: number | bigint, exchangeRate: number | bigint, baseDecimals?: number, lstDecimals?: number): bigint;
/**
 * Verifies withdrawal amounts by calculating expected values based on the pair's configuration
 * and comparing them with actual values from the blockchain.
 *
 * @param pair The Pair account data
 * @param lstAmount The amount of LST tokens requested for withdrawal
 * @param currentTimestamp The current timestamp (in seconds from Unix epoch)
 * @returns Object containing expected values for verification
 */
export declare function verifyWithdrawalAmounts(pair: LiquidStaking.PairAccountData, lstAmount: number | bigint, currentTimestamp: number | bigint | Date): {
    expectedBaseAmount: bigint;
    expectedLstBurnAmount: bigint;
    expectedFeeAmount: bigint;
    calculatedExchangeRate: bigint;
};
/**
 * Tests withdrawal amounts by comparing expected values with actual values
 *
 * @param pair The Pair account data
 * @param requestedAmount The amount of LST tokens requested for withdrawal
 * @param actualLstBurned The actual amount of LST tokens burned (from blockchain)
 * @param actualBaseAmount The actual amount of base tokens to receive (from blockchain)
 * @param currentTimestamp The current timestamp
 * @returns Object containing comparison results and details
 */
export declare function testWithdrawalAmounts(pair: LiquidStaking.Pair, requestedAmount: number | bigint, actualLstBurned: number | bigint, actualBaseAmount: number | bigint, currentTimestamp: number | bigint | Date): {
    isLstBurnCorrect: boolean;
    isBaseAmountCorrect: boolean;
    expected: ReturnType<typeof verifyWithdrawalAmounts>;
    actual: {
        lstBurnAmount: bigint;
        baseAmount: bigint;
    };
};
/**
 * Extracts the APR (Annual Percentage Rate) from an interval rate.
 * Unlike APY, APR does not account for compounding effects.
 *
 * @param intervalRate - The rate per interval
 * @param intervalSeconds - Duration of each interval in seconds
 * @returns The APR in basis points (e.g., 500 for 5%)
 */
export declare function extractAprFromIntervalRate(intervalRate: number | bigint, intervalSeconds: number | bigint): bigint;
/**
 * Calculates the exchange rate without compounding (using APR).
 * This function applies the yield linearly over time.
 *
 * @param lastYieldChangeTimestamp - Timestamp of the last yield change
 * @param currentTimestamp - Current timestamp
 * @param intervalRate - Rate per interval
 * @param lastYieldChangeExchangeRate - Exchange rate at the last yield change
 * @param intervalSeconds - Duration of each interval in seconds
 * @returns The calculated exchange rate as a bigint
 */
export declare function calculateExchangeRateWithoutCompounding(lastYieldChangeTimestamp: number | bigint, currentTimestamp: number | bigint, intervalRate: number | bigint, lastYieldChangeExchangeRate: number | bigint, intervalSeconds: number | bigint): bigint;
