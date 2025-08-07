import { getUnixTime } from 'date-fns';
import { LiquidStaking } from "../";

// Constants
export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
export const PRECISION = 1_000_000_000_000n;

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
export function calculateExchangeRate(
    lastYieldChangeTimestamp: number | bigint,
    currentTimestamp: number | bigint,
    intervalRate: number | bigint,
    lastYieldChangeExchangeRate: number | bigint,
    intervalSeconds: number | bigint
): bigint {
    // Convert all inputs to BigInt
    const lastTimestamp = BigInt(lastYieldChangeTimestamp);
    const currentTime = BigInt(currentTimestamp);
    const interval = BigInt(intervalRate);
    const lastExchangeRate = BigInt(lastYieldChangeExchangeRate);
    const secondsPerInterval = BigInt(intervalSeconds);

    if (currentTime === lastTimestamp) {
        return lastExchangeRate;
    }

    const elapsedTime = currentTime - lastTimestamp;
    const intervalAmounts = elapsedTime / secondsPerInterval;
    const remainingSeconds = elapsedTime % secondsPerInterval;

    // Calculate compounded rate for full intervals
    let compoundedRate = PRECISION;
    for (let i = 0n; i < intervalAmounts; i++) {
        compoundedRate = (compoundedRate * interval) / PRECISION;
    }

    // Calculate the linear yield for the remaining seconds
    const yieldPortion = interval - PRECISION;
    const linearYield = (yieldPortion * remainingSeconds) / secondsPerInterval;

    // Add the linear yield to the compounded rate
    const totalRate = compoundedRate + linearYield;

    // Multiply the current exchange rate with the total rate
    const newExchangeRate = (lastExchangeRate * totalRate) / PRECISION;

    return newExchangeRate;
}
/**
 * Calculates the interval rate needed to achieve a target annual yield with high precision.
 * This function uses the exact compound interest formula to avoid approximation errors.
 * 
 * @param targetApyBps - Target annual yield in basis points (e.g., 500 for 5%)
 * @param intervalSeconds - Duration of each interval in seconds
 * @returns The interval rate value to use in the Pair struct
 */
export function calculateIntervalRateFromApy(
    targetApyBps: number | bigint,
    intervalSeconds: number | bigint
): bigint {
    // Constants for precision
    const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
    const PRECISION = 1_000_000_000_000n;

    // Convert inputs to BigInt
    const targetApyBpsBigInt = BigInt(targetApyBps);
    const intervalSecondsBigInt = BigInt(intervalSeconds);

    // If APY is 0, return PRECISION (which represents 1.0)
    if (targetApyBpsBigInt === 0n) {
        return PRECISION;
    }

    // Calculate intervals per year
    const intervalsPerYear = SECONDS_PER_YEAR / intervalSecondsBigInt;

    // For exact calculation, we need to use Math.pow and then convert back to bigint
    // Convert APY from basis points to decimal
    const targetApyDecimal = Number(targetApyBpsBigInt) / 10000;

    // Calculate exact interval rate using the compound interest formula: (1 + r)^(1/n)
    const exactIntervalRate = Math.pow(1 + targetApyDecimal, 1 / Number(intervalsPerYear));

    // Convert back to bigint with PRECISION scaling
    const intervalRate = BigInt(Math.round(exactIntervalRate * Number(PRECISION)));

    return intervalRate;
}


/**
 * This function calculates the annual yield in basis points (bps) based on the interval rate and the interval duration in seconds.
 * Uses BigInt for all calculations to avoid floating-point errors.
 * Implements the exact compound interest formula (1 + r)^n - 1 for maximum accuracy.
 *
 * @param intervalRateParam - The interval rate, adjusted for precision.
 * @param intervalSeconds - The duration of each interval in seconds.
 * @returns The calculated annual yield in basis points (bps) as a BigInt.
 */
export function calculateAnnualYieldBps(
    intervalRateParam: number | bigint,
    intervalSeconds: number | bigint
): bigint {
    // Constants
    const BPS_MULTIPLIER = 10_000n;
    const SECONDS_PER_YEAR_BIG = 365n * 24n * 60n * 60n;

    // Higher internal precision for calculations (10x normal precision)
    const INTERNAL_PRECISION = PRECISION * 10n;

    // Convert inputs to BigInt
    const intervalRate = BigInt(intervalRateParam);
    const intervalSecondsBig = BigInt(intervalSeconds);

    // Calculate intervals per year
    const intervalsPerYear = SECONDS_PER_YEAR_BIG / intervalSecondsBig;

    // Calculate yield per interval with higher precision
    const yieldPerInterval = intervalRate > PRECISION
        ? (intervalRate - PRECISION) * 10n  // Scale up for higher precision
        : 0n;

    if (yieldPerInterval === 0n) {
        return 0n;
    }

    // Start with 1.0 (represented as INTERNAL_PRECISION)
    let compoundedRate = INTERNAL_PRECISION;

    // Scale up intervalRate to match internal precision
    const scaledIntervalRate = INTERNAL_PRECISION + yieldPerInterval;

    // Perform the exponentiation by repeated multiplication
    // This is the most accurate approach, even if less efficient
    for (let i = 0n; i < intervalsPerYear; i++) {
        compoundedRate = (compoundedRate * scaledIntervalRate) / INTERNAL_PRECISION;
    }

    // Calculate (1 + r)^n - 1 with proper scaling
    const annualYield = compoundedRate - INTERNAL_PRECISION;

    // Convert to basis points with careful rounding
    // Add half the divisor for proper rounding
    const annualYieldBps = ((annualYield * BPS_MULTIPLIER) + (INTERNAL_PRECISION / 2n)) / INTERNAL_PRECISION;

    return annualYieldBps;
}

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
export function verifyIntervalRate(
    intervalRate: bigint,
    targetApyBps: number | bigint,
    intervalSeconds: number | bigint
): {
    targetApyBps: bigint;
    actualApyBps: bigint;
    errorBps: bigint;
    errorPercentage: string;
} {
    const targetApyBpsBig = BigInt(targetApyBps);
    const actualApyBps = calculateAnnualYieldBps(intervalRate, intervalSeconds);
    const error = actualApyBps > targetApyBpsBig
        ? actualApyBps - targetApyBpsBig
        : targetApyBpsBig - actualApyBps;

    // Convert to numbers for logging only
    const targetApyBpsNum = Number(targetApyBpsBig);
    const errorNum = Number(error);
    const errorPercentage = (errorNum / targetApyBpsNum * 100).toFixed(6);

    return {
        targetApyBps: targetApyBpsBig,
        actualApyBps,
        errorBps: error,
        errorPercentage
    };
}

// LST-specific calculation functions

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
export function calculateLstExchangeRate(
    pair: YieldParams,
    currentTimestamp: number | bigint
): bigint {
    return calculateExchangeRate(
        pair.lastYieldChangeTimestamp,
        currentTimestamp,
        pair.intervalAprRate,
        pair.lastYieldChangeExchangeRate,
        pair.secondsPerInterval
    );
}

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
export function calculateLstAmount(
    baseAmount: number | bigint,
    exchangeRate: number | bigint,
    baseDecimals: number = 6,
    lstDecimals: number = 6
): bigint {
    const amount = BigInt(baseAmount);
    const rate = BigInt(exchangeRate);
    const baseDecimalsBig = BigInt(baseDecimals);
    const lstDecimalsBig = BigInt(lstDecimals);

    // First calculate the conversion based on exchange rate
    // Formula: (amount * PRECISION) / exchange_rate
    const baseConversion = (amount * PRECISION) / rate;

    // Then adjust for decimal places difference
    if (lstDecimalsBig > baseDecimalsBig) {
        // LST has more decimals than base, multiply by 10^difference
        const decimalAdjustment = lstDecimalsBig - baseDecimalsBig;
        return baseConversion * (10n ** decimalAdjustment);
    } else if (baseDecimalsBig > lstDecimalsBig) {
        // LST has fewer decimals than base, divide by 10^difference
        const decimalAdjustment = baseDecimalsBig - lstDecimalsBig;
        return baseConversion / (10n ** decimalAdjustment);
    } else {
        // Same number of decimals, no adjustment needed
        return baseConversion;
    }
}

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
export function calculateBaseAmount(
    lstAmount: number | bigint,
    exchangeRate: number | bigint,
    baseDecimals: number = 6,
    lstDecimals: number = 6
): bigint {
    const amount = BigInt(lstAmount);
    const rate = BigInt(exchangeRate);
    const baseDecimalsBig = BigInt(baseDecimals);
    const lstDecimalsBig = BigInt(lstDecimals);

    // First calculate the conversion based on exchange rate
    // Formula: (amount * exchange_rate) / PRECISION
    const lstConversion = (amount * rate) / PRECISION;

    // Then adjust for decimal places difference
    if (baseDecimalsBig > lstDecimalsBig) {
        // Base has more decimals than LST, multiply by 10^difference
        const decimalAdjustment = baseDecimalsBig - lstDecimalsBig;
        return lstConversion * (10n ** decimalAdjustment);
    } else if (lstDecimalsBig > baseDecimalsBig) {
        // Base has fewer decimals than LST, divide by 10^difference
        const decimalAdjustment = lstDecimalsBig - baseDecimalsBig;
        return lstConversion / (10n ** decimalAdjustment);
    } else {
        // Same number of decimals, no adjustment needed
        return lstConversion;
    }
}

/**
 * Verifies withdrawal amounts by calculating expected values based on the pair's configuration
 * and comparing them with actual values from the blockchain.
 * 
 * @param pair The Pair account data
 * @param lstAmount The amount of LST tokens requested for withdrawal
 * @param currentTimestamp The current timestamp (in seconds from Unix epoch)
 * @returns Object containing expected values for verification
 */
export function verifyWithdrawalAmounts(
    pair: LiquidStaking.PairAccountData,
    lstAmount: number | bigint,
    currentTimestamp: number | bigint | Date
): {
    expectedBaseAmount: bigint;
    expectedLstBurnAmount: bigint;
    expectedFeeAmount: bigint;
    calculatedExchangeRate: bigint;
} {
    // Ensure timestamp is in seconds from Unix epoch
    const timestamp = currentTimestamp instanceof Date
        ? BigInt(getUnixTime(currentTimestamp))
        : BigInt(currentTimestamp);

    // Convert amount to bigint
    const amount = BigInt(lstAmount);

    // Calculate exchange rate
    const exchangeRate = calculateLstExchangeRate(
        {
            lastYieldChangeTimestamp: pair.lastYieldChangeTimestamp,
            lastYieldChangeExchangeRate: pair.lastYieldChangeExchangeRate,
            intervalAprRate: pair.intervalAprRate,
            secondsPerInterval: pair.secondsPerInterval
        },
        timestamp
    );

    // Calculate fee (same as in Pair.calculate_withdraw_fee_lst)
    const feeBps = BigInt(pair.withdrawFeeBps);
    const feeAmount = (amount * feeBps) / BigInt(10000);

    // Calculate LST burn amount (amount - fee)
    const lstBurnAmount = amount - feeAmount;

    // Calculate base token amount using the new function that matches Rust implementation
    const baseAmount = calculateBaseAmount(
        lstBurnAmount,
        exchangeRate,
        Number(pair.baseMintDecimals),
        Number(pair.lstMintDecimals)
    );

    return {
        expectedBaseAmount: baseAmount,
        expectedLstBurnAmount: lstBurnAmount,
        expectedFeeAmount: feeAmount,
        calculatedExchangeRate: exchangeRate
    };
}

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
export function testWithdrawalAmounts(
    pair: LiquidStaking.Pair,
    requestedAmount: number | bigint,
    actualLstBurned: number | bigint,
    actualBaseAmount: number | bigint,
    currentTimestamp: number | bigint | Date
): {
    isLstBurnCorrect: boolean;
    isBaseAmountCorrect: boolean;
    expected: ReturnType<typeof verifyWithdrawalAmounts>;
    actual: { lstBurnAmount: bigint; baseAmount: bigint };
} {
    const expected = verifyWithdrawalAmounts(pair, requestedAmount, currentTimestamp);
    const actual = {
        lstBurnAmount: BigInt(actualLstBurned),
        baseAmount: BigInt(actualBaseAmount)
    };

    return {
        isLstBurnCorrect: expected.expectedLstBurnAmount === actual.lstBurnAmount,
        isBaseAmountCorrect: expected.expectedBaseAmount === actual.baseAmount,
        expected,
        actual
    };
}

/**
 * Extracts the APR (Annual Percentage Rate) from an interval rate.
 * Unlike APY, APR does not account for compounding effects.
 * 
 * @param intervalRate - The rate per interval
 * @param intervalSeconds - Duration of each interval in seconds
 * @returns The APR in basis points (e.g., 500 for 5%)
 */
export function extractAprFromIntervalRate(
    intervalRate: number | bigint,
    intervalSeconds: number | bigint
): bigint {
    // Constants
    const BPS_MULTIPLIER = 10_000n;
    const SECONDS_PER_YEAR_BIG = 365n * 24n * 60n * 60n;

    // Convert inputs to BigInt
    const rate = BigInt(intervalRate);
    const intervalSecondsBig = BigInt(intervalSeconds);

    // Calculate intervals per year
    const intervalsPerYear = SECONDS_PER_YEAR_BIG / intervalSecondsBig;

    // Extract the yield portion from the interval rate
    const yieldPortion = rate > PRECISION
        ? (rate - PRECISION)
        : 0n;

    // Calculate APR in basis points
    // APR = yieldPortion * intervalsPerYear * BPS_MULTIPLIER / PRECISION
    const aprBps = (yieldPortion * intervalsPerYear * BPS_MULTIPLIER) / PRECISION;

    return aprBps;
}

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
export function calculateExchangeRateWithoutCompounding(
    lastYieldChangeTimestamp: number | bigint,
    currentTimestamp: number | bigint,
    intervalRate: number | bigint,
    lastYieldChangeExchangeRate: number | bigint,
    intervalSeconds: number | bigint
): bigint {
    // Convert all inputs to BigInt
    const lastTimestamp = BigInt(lastYieldChangeTimestamp);
    const currentTime = BigInt(currentTimestamp);
    const interval = BigInt(intervalRate);
    const lastExchangeRate = BigInt(lastYieldChangeExchangeRate);
    const secondsPerInterval = BigInt(intervalSeconds);

    if (currentTime === lastTimestamp) {
        return lastExchangeRate;
    }

    // Calculate elapsed time in seconds
    const elapsedTime = currentTime - lastTimestamp;

    // Calculate the yield portion from the interval rate
    const yieldPortion = interval > PRECISION
        ? (interval - PRECISION)
        : 0n;

    // Calculate the linear yield over the elapsed time
    // linearYield = yieldPortion * elapsedTime / secondsPerInterval
    const linearYield = (yieldPortion * elapsedTime) / secondsPerInterval;

    // Calculate the total rate (1 + linearYield)
    const totalRate = PRECISION + linearYield;

    // Calculate the new exchange rate
    const newExchangeRate = (lastExchangeRate * totalRate) / PRECISION;

    return newExchangeRate;
}
