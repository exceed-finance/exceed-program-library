import { expect } from "chai";
import { addDays, addHours, addSeconds, fromUnixTime, getUnixTime, hoursToSeconds } from "date-fns";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint,
    createPairAccounts,
    timeTravel,
    getTokenAccountData,
    SOL_USD_FEED_ADDRESS,
    setPriceFeedTime,
} from "../helpers";
import { createAssociatedToken, findAssociatedTokenPda, mintTokensTo, setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { none, transactionBuilder } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { calculateIntervalRateFromApy, calculateExchangeRate, PRECISION, verifyIntervalRate, verifyWithdrawalAmounts, calculateLstAmount, calculateBaseAmount } from "../../clients/js/src";
import { createWithdrawalWindow, executeWithdraw, fundWithdrawalWindow, getWithdrawalWindowAccountDataSerializer, requestWithdraw, stake } from "../../clients/js/src/generated/liquid_staking";
import { findWithdrawalWindowPda } from "../../clients/js/src";

describe("rates", () => {
    it("should handle time-based exchange rate calculations correctly", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority);


        const apyBps = 500n;
        const intervalSeconds = hoursToSeconds(8);
        const intervalRate = calculateIntervalRateFromApy(apyBps, intervalSeconds);

        // Create pair with specific APY
        const pair = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            intervalAprRate: intervalRate, // 5% APY with 8-hour intervals
            secondsPerInterval: intervalSeconds // 8 hours in seconds
        });

        // Create staker and stake tokens
        const staker = createUser(svm, umi);

        const [stakerLstTokenAddress] = findAssociatedTokenPda(umi, {
            owner: staker.publicKey,
            mint: pair.lstAddress
        })
        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });
        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            owner: accessControl.authorities.depositAuthority.publicKey,
            mint: baseMint.mintKeypair.publicKey
        });

        const mintTx = await transactionBuilder().add(
            createAssociatedToken(umi, {
                owner: staker.publicKey,
                mint: baseMint.mintKeypair.publicKey
            })
        )
            .add(
                createAssociatedToken(umi, {
                    owner: accessControl.authorities.depositAuthority.publicKey,
                    mint: baseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(umi, {
                    token: stakerBaseTokenAddress,
                    amount: 300_000_000,
                    mint: baseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .add(
                mintTokensTo(umi, {
                    token: depositAuthorityBaseTokenAddress,
                    mint: baseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority,
                    amount: 900_000_000
                })
            ).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const mintResult = svm.sendTransaction(toWeb3JsTransaction(mintTx));
        // console.log(mintResult)

        // Stake tokens
        setPriceFeedTime(svm, 30)
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: pair.lstTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            quantity: 100_000_000n,
            merkleProof: none(),
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const stakeResult = svm.sendTransaction(toWeb3JsTransaction(stakeTx))
        // console.log(stakeResult.toString())

        // Record initial exchange rate
        const exchangeRate = calculateExchangeRate(
            getUnixTime(currentTime),
            getUnixTime(currentTime),
            intervalRate,
            1n * PRECISION,
            intervalSeconds
        )

        const expectedExchangeRate = calculateExchangeRate(
            getUnixTime(currentTime),
            getUnixTime(addDays(currentTime, 365)),
            intervalRate,
            1n * PRECISION,
            intervalSeconds
        )

        // Time travel to 1 year in the future
        const now = addDays(currentTime, 365)
        timeTravel(svm, now);

        const startTime = addSeconds(now, 1);
        const endTime = addDays(now, 1)
        const earliestWithdrawalTime = addDays(endTime, 7)
        const expirationTime = addDays(startTime, 90);

        const [withdrawalWindowAddress] = findWithdrawalWindowPda(umi, pair.pairAddress, getUnixTime(startTime))

        const [windowBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: withdrawalWindowAddress
        });

        const [windowLstAddress] = findAssociatedTokenPda(umi, {
            mint: pair.lstAddress,
            owner: withdrawalWindowAddress
        })

        const withdrawalWindowTx = await createWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            windowLstAccount: windowLstAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstMint: pair.lstAddress,
            startTime: getUnixTime(startTime),
            endTime: getUnixTime(endTime),
            earliestWithdrawalTime: getUnixTime(earliestWithdrawalTime),
            expirationTime: getUnixTime(expirationTime),
            maxWithdrawalAmount: 500_000_000,
            authority: accessControl.authorities.windowAuthority
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)

        const withdrawalWindowResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalWindowTx))

        const windowSerializer = getWithdrawalWindowAccountDataSerializer();
        const windowAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalWindowAddress));
        const [window] = windowSerializer.deserialize(windowAccount.data);

        const requestTime = addHours(fromUnixTime(Number(window.startTime)), 1)
        timeTravel(svm, requestTime)

        const requestedWithdrawalAmount = 100_000_000;
        // create withdrawal request
        setPriceFeedTime(svm, 30)
        const withdrawalRequestTx = await requestWithdraw(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            staker: staker,
            stakerLstAccount: stakerLstTokenAddress,
            lstMint: pair.lstAddress,
            accessControl: accessControl.accessControlAddress,
            amount: requestedWithdrawalAmount,
            merkleProof: none(),
            priceFeed: SOL_USD_FEED_ADDRESS
        }).prepend(
            setComputeUnitLimit(umi, {
                units: 1_000_000
            })
        ).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const withdrawalRequestResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalRequestTx))
        // console.log(withdrawalRequestResult.toString())

        // fund the withdrawal window
        const fundTime = addHours(fromUnixTime(Number(window.endTime)), 1);
        timeTravel(svm, fundTime);


        const fundTx = await fundWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            depositAuthority: accessControl.authorities.depositAuthority,
            accessControl: accessControl.accessControlAddress,
            depositAuthorityBaseTokenAccount: depositAuthorityBaseTokenAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)

        const fundResult = svm.sendTransaction(toWeb3JsTransaction(fundTx))

        // get user's base token balance, then execute the withdrawal.
        const { amount: amountBefore } = getTokenAccountData(svm, stakerBaseTokenAddress);

        const withdrawalTime = addHours(earliestWithdrawalTime, 1);

        timeTravel(svm, withdrawalTime);
        setPriceFeedTime(svm, 30);

        const withdrawalTx = await executeWithdraw(umi, {
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            withdrawalWindow: withdrawalWindowAddress,
            staker: staker,
            stakerBaseTokenAccount: stakerBaseTokenAddress,
            accessControl: accessControl.accessControlAddress,
            lstMint: pair.lstAddress,
            windowLstAccount: windowLstAddress,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const withdrawalResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalTx));
        // console.log(withdrawalResult.toString())

        const { amount: amountAfter } = getTokenAccountData(svm, stakerBaseTokenAddress);
        const withdrawnAmount = amountAfter - amountBefore;

        const { expectedBaseAmount } = verifyWithdrawalAmounts(
            pair.pair,
            requestedWithdrawalAmount,
            requestTime
        )

        expect(expectedBaseAmount).to.equal(withdrawnAmount);
    });

    it.skip("should handle minimum and maximum values correctly", async () => { });

    it("should handle staking and withdrawing with a pair with no yield", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority);


        const apyBps = 0n;
        const intervalSeconds = hoursToSeconds(24 * 7);
        const intervalRate = calculateIntervalRateFromApy(apyBps, intervalSeconds);

        // Create pair with specific APY
        const pair = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            intervalAprRate: intervalRate,
            secondsPerInterval: intervalSeconds
        });

        // Create staker and stake tokens
        const staker = createUser(svm, umi);

        const [stakerLstTokenAddress] = findAssociatedTokenPda(umi, {
            owner: staker.publicKey,
            mint: pair.lstAddress
        })
        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });
        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            owner: accessControl.authorities.depositAuthority.publicKey,
            mint: baseMint.mintKeypair.publicKey
        });

        const mintTx = await transactionBuilder().add(
            createAssociatedToken(umi, {
                owner: staker.publicKey,
                mint: baseMint.mintKeypair.publicKey
            })
        )
            .add(
                createAssociatedToken(umi, {
                    owner: accessControl.authorities.depositAuthority.publicKey,
                    mint: baseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(umi, {
                    token: stakerBaseTokenAddress,
                    amount: 300_000_000,
                    mint: baseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .add(
                mintTokensTo(umi, {
                    token: depositAuthorityBaseTokenAddress,
                    mint: baseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority,
                    amount: 900_000_000
                })
            ).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const mintResult = svm.sendTransaction(toWeb3JsTransaction(mintTx));
        // console.log(mintResult)

        // Stake tokens
        setPriceFeedTime(svm, 30)
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: pair.lstTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            quantity: 100_000_000n,
            merkleProof: none(),
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const stakeResult = svm.sendTransaction(toWeb3JsTransaction(stakeTx))
        // console.log(stakeResult.toString())

        // Time travel to 1 year in the future
        const now = addDays(currentTime, 365)
        timeTravel(svm, now);

        const startTime = addSeconds(now, 1);
        const endTime = addDays(now, 1)
        const earliestWithdrawalTime = addDays(endTime, 7)
        const expirationTime = addDays(startTime, 90);

        const [withdrawalWindowAddress] = findWithdrawalWindowPda(umi, pair.pairAddress, getUnixTime(startTime))

        const [windowBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: withdrawalWindowAddress
        });

        const [windowLstAddress] = findAssociatedTokenPda(umi, {
            mint: pair.lstAddress,
            owner: withdrawalWindowAddress
        })

        const withdrawalWindowTx = await createWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            windowLstAccount: windowLstAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstMint: pair.lstAddress,
            startTime: getUnixTime(startTime),
            endTime: getUnixTime(endTime),
            earliestWithdrawalTime: getUnixTime(earliestWithdrawalTime),
            expirationTime: getUnixTime(expirationTime),
            maxWithdrawalAmount: 500_000_000,
            authority: accessControl.authorities.windowAuthority
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)

        const withdrawalWindowResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalWindowTx))

        const windowSerializer = getWithdrawalWindowAccountDataSerializer();
        const windowAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalWindowAddress));
        const [window] = windowSerializer.deserialize(windowAccount.data);

        const requestTime = addHours(fromUnixTime(Number(window.startTime)), 1)
        timeTravel(svm, requestTime)

        const requestedWithdrawalAmount = 100_000_000;
        // create withdrawal request
        setPriceFeedTime(svm, 30)
        const withdrawalRequestTx = await requestWithdraw(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            staker: staker,
            stakerLstAccount: stakerLstTokenAddress,
            lstMint: pair.lstAddress,
            accessControl: accessControl.accessControlAddress,
            amount: requestedWithdrawalAmount,
            merkleProof: none(),
            windowLstAccount: windowLstAddress,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).prepend(
            setComputeUnitLimit(umi, {
                units: 1_000_000
            })
        ).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const withdrawalRequestResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalRequestTx))
        // console.log(withdrawalRequestResult.toString())

        // fund the withdrawal window
        const fundTime = addHours(fromUnixTime(Number(window.endTime)), 1);
        timeTravel(svm, fundTime);


        const fundTx = await fundWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            depositAuthority: accessControl.authorities.depositAuthority,
            accessControl: accessControl.accessControlAddress,
            depositAuthorityBaseTokenAccount: depositAuthorityBaseTokenAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)

        const fundResult = svm.sendTransaction(toWeb3JsTransaction(fundTx))

        // get user's base token balance, then execute the withdrawal.
        const { amount: amountBefore } = getTokenAccountData(svm, stakerBaseTokenAddress);

        const withdrawalTime = addHours(earliestWithdrawalTime, 1);
        timeTravel(svm, withdrawalTime);

        setPriceFeedTime(svm, 30);

        const withdrawalTx = await executeWithdraw(umi, {
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            withdrawalWindow: withdrawalWindowAddress,
            staker: staker,
            stakerBaseTokenAccount: stakerBaseTokenAddress,
            accessControl: accessControl.accessControlAddress,
            lstMint: pair.lstAddress,
            windowLstAccount: windowLstAddress,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const withdrawalResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalTx));
        // console.log(withdrawalResult.toString())

        const { amount: amountAfter } = getTokenAccountData(svm, stakerBaseTokenAddress);
        const withdrawnAmount = amountAfter - amountBefore;

        const { expectedBaseAmount } = verifyWithdrawalAmounts(
            pair.pair,
            requestedWithdrawalAmount,
            requestTime
        )

        expect(expectedBaseAmount).to.equal(withdrawnAmount);
    });

    describe("Rate conversion functions", () => {
        describe("calculateLstAmount (BaseToLst conversion)", () => {
            it("should calculate LST amount correctly with same decimals", () => {
                const baseAmount = 1_000_000n; // 1 token with 6 decimals
                const exchangeRate = 1_050_000n; // 1.05 exchange rate
                const baseDecimals = 6;
                const lstDecimals = 6;

                const lstAmount = calculateLstAmount(baseAmount, exchangeRate, baseDecimals, lstDecimals);

                // Expected: (1_000_000 * PRECISION) / 1_050_000 = 952,380
                const expected = (baseAmount * PRECISION) / exchangeRate;
                expect(lstAmount).to.equal(expected);
            });

            it("should handle decimal differences correctly - more LST decimals", () => {
                const baseAmount = 1_000_000n; // 1 token with 6 decimals
                const exchangeRate = 1_000_000n; // 1.0 exchange rate
                const baseDecimals = 6;
                const lstDecimals = 9; // LST has 3 more decimals

                const lstAmount = calculateLstAmount(baseAmount, exchangeRate, baseDecimals, lstDecimals);

                // Expected: (1_000_000 * PRECISION) / 1_000_000 * 10^3 = 1_000_000_000
                const baseConversion = (baseAmount * PRECISION) / exchangeRate;
                const expected = baseConversion * (10n ** 3n);
                expect(lstAmount).to.equal(expected);
            });

            it("should handle decimal differences correctly - fewer LST decimals", () => {
                const baseAmount = 1_000_000n; // 1 token with 6 decimals
                const exchangeRate = 1_000_000n; // 1.0 exchange rate
                const baseDecimals = 6;
                const lstDecimals = 4; // LST has 2 fewer decimals

                const lstAmount = calculateLstAmount(baseAmount, exchangeRate, baseDecimals, lstDecimals);

                // Expected: (1_000_000 * PRECISION) / 1_000_000 / 10^2 = 10_000
                const baseConversion = (baseAmount * PRECISION) / exchangeRate;
                const expected = baseConversion / (10n ** 2n);
                expect(lstAmount).to.equal(expected);
            });

            it("should handle zero amount", () => {
                const baseAmount = 0n;
                const exchangeRate = 1_050_000n;
                const baseDecimals = 6;
                const lstDecimals = 6;

                const lstAmount = calculateLstAmount(baseAmount, exchangeRate, baseDecimals, lstDecimals);
                expect(lstAmount).to.equal(0n);
            });

            it("should handle precision exchange rate", () => {
                const baseAmount = 1_000_000n;
                const exchangeRate = PRECISION; // 1.0 exactly
                const baseDecimals = 6;
                const lstDecimals = 6;

                const lstAmount = calculateLstAmount(baseAmount, exchangeRate, baseDecimals, lstDecimals);
                expect(lstAmount).to.equal(baseAmount); // Should be 1:1
            });
        });

        describe("calculateBaseAmount (LstToBase conversion)", () => {
            it("should calculate base amount correctly with same decimals", () => {
                const lstAmount = 952_380n; // Amount that should convert back to ~1 token
                const exchangeRate = 1_050_000n; // 1.05 exchange rate
                const baseDecimals = 6;
                const lstDecimals = 6;

                const baseAmount = calculateBaseAmount(lstAmount, exchangeRate, baseDecimals, lstDecimals);

                // Expected: (952_380 * 1_050_000) / PRECISION = 999,999
                const expected = (lstAmount * exchangeRate) / PRECISION;
                expect(baseAmount).to.equal(expected);
            });

            it("should handle decimal differences correctly - more base decimals", () => {
                const lstAmount = 1_000_000n; // 1 token with 6 decimals
                const exchangeRate = 1_000_000n; // 1.0 exchange rate
                const baseDecimals = 9; // Base has 3 more decimals
                const lstDecimals = 6;

                const baseAmount = calculateBaseAmount(lstAmount, exchangeRate, baseDecimals, lstDecimals);

                // Expected: (1_000_000 * 1_000_000) / PRECISION * 10^3 = 1_000_000_000
                const lstConversion = (lstAmount * exchangeRate) / PRECISION;
                const expected = lstConversion * (10n ** 3n);
                expect(baseAmount).to.equal(expected);
            });

            it("should handle decimal differences correctly - fewer base decimals", () => {
                const lstAmount = 1_000_000n; // 1 token with 6 decimals
                const exchangeRate = 1_000_000n; // 1.0 exchange rate
                const baseDecimals = 4; // Base has 2 fewer decimals
                const lstDecimals = 6;

                const baseAmount = calculateBaseAmount(lstAmount, exchangeRate, baseDecimals, lstDecimals);

                // Expected: (1_000_000 * 1_000_000) / PRECISION / 10^2 = 10_000
                const lstConversion = (lstAmount * exchangeRate) / PRECISION;
                const expected = lstConversion / (10n ** 2n);
                expect(baseAmount).to.equal(expected);
            });

            it("should handle zero amount", () => {
                const lstAmount = 0n;
                const exchangeRate = 1_050_000n;
                const baseDecimals = 6;
                const lstDecimals = 6;

                const baseAmount = calculateBaseAmount(lstAmount, exchangeRate, baseDecimals, lstDecimals);
                expect(baseAmount).to.equal(0n);
            });

            it("should handle precision exchange rate", () => {
                const lstAmount = 1_000_000n;
                const exchangeRate = PRECISION; // 1.0 exactly
                const baseDecimals = 6;
                const lstDecimals = 6;

                const baseAmount = calculateBaseAmount(lstAmount, exchangeRate, baseDecimals, lstDecimals);
                expect(baseAmount).to.equal(lstAmount); // Should be 1:1
            });
        });

        describe("Round-trip conversions", () => {
            it("should maintain consistency in round-trip conversions with same decimals", () => {
                const originalBaseAmount = 1_000_000n;
                const exchangeRate = 1_050_000n; // 5% premium
                const decimals = 6;

                // Convert base to LST
                const lstAmount = calculateLstAmount(originalBaseAmount, exchangeRate, decimals, decimals);

                // Convert LST back to base
                const recoveredBaseAmount = calculateBaseAmount(lstAmount, exchangeRate, decimals, decimals);

                // Should be very close to original (within rounding error)
                const difference = originalBaseAmount > recoveredBaseAmount
                    ? originalBaseAmount - recoveredBaseAmount
                    : recoveredBaseAmount - originalBaseAmount;

                // Allow for small rounding differences (less than 0.1% of original)
                expect(Number(difference)).to.be.lessThan(Number(originalBaseAmount / 1000n));
            });

            it("should maintain consistency in round-trip conversions with different decimals", () => {
                const originalBaseAmount = 1_000_000n; // 6 decimals
                const exchangeRate = 1_050_000n;
                const baseDecimals = 6;
                const lstDecimals = 9; // 3 more decimals

                // Convert base to LST
                const lstAmount = calculateLstAmount(originalBaseAmount, exchangeRate, baseDecimals, lstDecimals);

                // Convert LST back to base
                const recoveredBaseAmount = calculateBaseAmount(lstAmount, exchangeRate, baseDecimals, lstDecimals);

                // Should be very close to original (within rounding error)
                const difference = originalBaseAmount > recoveredBaseAmount
                    ? originalBaseAmount - recoveredBaseAmount
                    : recoveredBaseAmount - originalBaseAmount;

                // Allow for small rounding differences
                expect(Number(difference)).to.be.lessThan(Number(originalBaseAmount / 1000n));
            });
        });

        describe("Edge cases", () => {
            it("should handle large amounts without overflow", () => {
                const baseAmount = 1_000_000_000_000n; // Very large amount
                const exchangeRate = 2_000_000n; // 2x exchange rate
                const decimals = 6;

                expect(() => {
                    calculateLstAmount(baseAmount, exchangeRate, decimals, decimals);
                }).to.not.throw();

                expect(() => {
                    calculateBaseAmount(baseAmount, exchangeRate, decimals, decimals);
                }).to.not.throw();
            });

            it("should handle high precision exchange rates", () => {
                const baseAmount = 1_000_000n;
                const exchangeRate = PRECISION + 1n; // Slightly above 1.0
                const decimals = 6;

                const lstAmount = calculateLstAmount(baseAmount, exchangeRate, decimals, decimals);
                const baseAmountBack = calculateBaseAmount(lstAmount, exchangeRate, decimals, decimals);

                // Should be close to original
                const difference = baseAmount > baseAmountBack
                    ? baseAmount - baseAmountBack
                    : baseAmountBack - baseAmount;

                // Allow for small rounding differences
                expect(Number(difference)).to.be.lessThan(1000);
            });

            it("should work with recent exchange rate", () => {
                const startingBaseAmount = 1_000_000n;
                const startingLstAmount = 909090n;
                const exchangeRate = 1_100_000_000_000n; // Slightly above 1.0
                const decimals = 6;

                // const baseConversion = (amount * PRECISION) / rate;
                // { lstAmount: 909090n, baseFromLst: 1100000n, baseAmountBack: 999999n }

                const baseFromLst = calculateBaseAmount(startingLstAmount, exchangeRate, decimals, decimals)
                const lstAmount = calculateLstAmount(startingBaseAmount, exchangeRate, decimals, decimals);
                const baseAmountBack = calculateBaseAmount(lstAmount, exchangeRate, decimals, decimals);

                // console.log({ lstAmount, baseFromLst, baseAmountBack })

            });
        });
    });

});
