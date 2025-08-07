import { expect } from "chai";
import { addSeconds, addHours, addDays, getUnixTime, fromUnixTime, hoursToSeconds } from "date-fns";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createTestMint,
    createUser,
    createPairAccounts,
    timeTravel,
    getTokenAccountData,
    SOL_USD_FEED_ADDRESS,
    setPriceFeedTime,
} from "../helpers";
import { createAssociatedToken, findAssociatedTokenPda, mintTokensTo, setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { none, transactionBuilder } from "@metaplex-foundation/umi";
import { fromWeb3JsTransaction, toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { calculateIntervalRateFromApy, PRECISION } from "../../clients/js/src";
import { cancelWithdrawalRequest, createWithdrawalWindow, executeWithdraw, fundWithdrawalWindow, getWithdrawalRequestAccountDataSerializer, getWithdrawalWindowAccountDataSerializer, requestWithdraw, stake, restakeExpiredWithdraw } from "../../clients/js/src/generated/liquid_staking";
import { findWithdrawalRequestPda, findWithdrawalWindowPda } from "../../clients/js";

describe("liquid-staking: withdrawal", () => {
    it("should not allow early withdrawals", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority);

        // Create pair with 5% APY
        const apyBps = 500n;
        const intervalSeconds = hoursToSeconds(8);
        const intervalRate = calculateIntervalRateFromApy(apyBps, intervalSeconds);

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
        });

        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            owner: accessControl.authorities.depositAuthority.publicKey,
            mint: baseMint.mintKeypair.publicKey
        });

        // Mint tokens to staker and deposit authority
        const mintTx = await transactionBuilder()
            .add(
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
            )
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(mintTx));

        setPriceFeedTime(svm, 30)
        // Stake tokens
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: pair.lstTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            quantity: 100_000_000n,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(stakeTx));

        // Create withdrawal window
        const startTime = addSeconds(currentTime, 1);
        const endTime = addDays(startTime, 1);
        const earliestWithdrawalTime = addDays(endTime, 7); // 7 days after end time
        const expirationTime = addDays(startTime, 90);

        const [withdrawalWindowAddress] = findWithdrawalWindowPda(
            umi,
            pair.pairAddress,
            getUnixTime(startTime)
        );

        const windowLstAddress = findAssociatedTokenPda(umi, {
            mint: pair.lstAddress,
            owner: withdrawalWindowAddress
        })

        const [windowBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: withdrawalWindowAddress
        });

        const withdrawalWindowTx = await createWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstMint: pair.lstAddress,
            startTime: getUnixTime(startTime),
            endTime: getUnixTime(endTime),
            earliestWithdrawalTime: getUnixTime(earliestWithdrawalTime),
            expirationTime: getUnixTime(expirationTime),
            maxWithdrawalAmount: 500_000_000,
            authority: accessControl.authorities.windowAuthority
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(withdrawalWindowTx));

        // Get window data
        const windowSerializer = getWithdrawalWindowAccountDataSerializer();
        const windowAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalWindowAddress));
        const [window] = windowSerializer.deserialize(windowAccount.data);

        // Request withdrawal
        const requestTime = addHours(fromUnixTime(Number(window.startTime)), 1);
        timeTravel(svm, requestTime);

        setPriceFeedTime(svm, 30);
        const requestedWithdrawalAmount = 50_000_000;
        const withdrawalRequestTx = await requestWithdraw(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            staker: staker,
            stakerLstAccount: stakerLstTokenAddress,
            windowLstAccount: windowLstAddress,
            lstMint: pair.lstAddress,
            accessControl: accessControl.accessControlAddress,
            amount: requestedWithdrawalAmount,
            merkleProof: none(),
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(withdrawalRequestTx));

        // Fund the withdrawal window
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
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(fundTx));

        // Get initial staker base token balance
        const { amount: initialBalance } = getTokenAccountData(svm, stakerBaseTokenAddress);

        // Get the withdrawal request PDA
        const [withdrawalRequestAddress] = findWithdrawalRequestPda(
            umi,
            withdrawalWindowAddress,
            staker.publicKey
        );

        // Try to execute withdrawal too early (before earliest withdrawal time)
        // Time travel to a time after end time but before earliest withdrawal time
        const earlyWithdrawalTime = addDays(endTime, 3); // 3 days after end time, but earliest is 7 days
        timeTravel(svm, earlyWithdrawalTime);

        // Attempt early withdrawal - this should fail but SVM won't throw an error
        const withdrawalTx = await executeWithdraw(umi, {
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            stakerBaseTokenAccount: stakerBaseTokenAddress,
            accessControl: accessControl.accessControlAddress
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const withdrawalResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalTx));
        // console.log("Early withdrawal result:", withdrawalResult.toString());
        // The transaction will be processed but should have no effect

        // Get final staker base token balance
        const { amount: finalBalance } = getTokenAccountData(svm, stakerBaseTokenAddress);

        // Verify that the withdrawal did not happen by checking the token balance
        expect(finalBalance).to.equal(initialBalance);

        // Verify the withdrawal request still exists and is not executed
        const withdrawalRequestAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress));
        expect(withdrawalRequestAccount).to.not.be.null;

        // Deserialize the withdrawal request to verify it's not executed
        const withdrawalRequestSerializer = getWithdrawalRequestAccountDataSerializer();
        const [withdrawalRequest] = withdrawalRequestSerializer.deserialize(withdrawalRequestAccount.data);
    })
    it("should not allow late withdrawals", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority);

        // Create pair with 5% APY
        const apyBps = 500n;
        const intervalSeconds = hoursToSeconds(8);
        const intervalRate = calculateIntervalRateFromApy(apyBps, intervalSeconds);

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
        });

        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            owner: accessControl.authorities.depositAuthority.publicKey,
            mint: baseMint.mintKeypair.publicKey
        });

        // Mint tokens to staker and deposit authority
        const mintTx = await transactionBuilder()
            .add(
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
            )
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(mintTx));

        setPriceFeedTime(svm, 30);
        // Stake tokens
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: pair.lstTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            quantity: 100_000_000n,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(stakeTx));

        // Create withdrawal window with a short expiration time
        const startTime = addSeconds(currentTime, 1);
        const endTime = addDays(startTime, 1);
        const earliestWithdrawalTime = addDays(endTime, 1); // 1 day after end time
        const expirationTime = addDays(startTime, 30); // 30 days from start

        const [withdrawalWindowAddress] = findWithdrawalWindowPda(
            umi,
            pair.pairAddress,
            getUnixTime(startTime)
        );

        const windowLstAddress = findAssociatedTokenPda(umi, {
            mint: pair.lstAddress,
            owner: withdrawalWindowAddress
        })

        const [windowBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: withdrawalWindowAddress
        });

        const withdrawalWindowTx = await createWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            windowLstAccount: windowLstAddress,
            lstMint: pair.lstAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            startTime: getUnixTime(startTime),
            endTime: getUnixTime(endTime),
            earliestWithdrawalTime: getUnixTime(earliestWithdrawalTime),
            expirationTime: getUnixTime(expirationTime),
            maxWithdrawalAmount: 500_000_000,
            authority: accessControl.authorities.windowAuthority
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(withdrawalWindowTx));

        // Get window data
        const windowSerializer = getWithdrawalWindowAccountDataSerializer();
        const windowAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalWindowAddress));
        const [window] = windowSerializer.deserialize(windowAccount.data);

        // Request withdrawal
        const requestTime = addHours(fromUnixTime(Number(window.startTime)), 1);
        timeTravel(svm, requestTime);

        setPriceFeedTime(svm, 30)
        const requestedWithdrawalAmount = 50_000_000;
        const withdrawalRequestTx = await requestWithdraw(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            staker: staker,
            stakerLstAccount: stakerLstTokenAddress,
            windowLstAccount: windowLstAddress,
            lstMint: pair.lstAddress,
            accessControl: accessControl.accessControlAddress,
            amount: requestedWithdrawalAmount,
            merkleProof: none(),
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(withdrawalRequestTx));

        // Fund the withdrawal window
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
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(fundTx));

        // Get initial staker base token balance
        const { amount: initialBalance } = getTokenAccountData(svm, stakerBaseTokenAddress);

        // Get the withdrawal request PDA
        const [withdrawalRequestAddress] = findWithdrawalRequestPda(
            umi,
            withdrawalWindowAddress,
            staker.publicKey
        );

        // Try to execute withdrawal after expiration time
        // Time travel to a time after expiration time
        const lateWithdrawalTime = addDays(startTime, 31); // 31 days after start, expiration is 30 days
        timeTravel(svm, lateWithdrawalTime);

        // Attempt late withdrawal - this should fail but SVM won't throw an error
        const withdrawalTx = await executeWithdraw(umi, {
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            stakerBaseTokenAccount: stakerBaseTokenAddress,
            accessControl: accessControl.accessControlAddress
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const withdrawalResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalTx));
        // console.log("Late withdrawal result:", withdrawalResult.toString());
        // The transaction will be processed but should have no effect

        // Get final staker base token balance
        const { amount: finalBalance } = getTokenAccountData(svm, stakerBaseTokenAddress);

        // Verify that the withdrawal did not happen by checking the token balance
        expect(finalBalance).to.equal(initialBalance);

        // Verify the withdrawal request still exists and is not executed
        const withdrawalRequestAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress));
        expect(withdrawalRequestAccount).to.not.be.null;

        // Deserialize the withdrawal request to verify it's not executed
        const withdrawalRequestSerializer = getWithdrawalRequestAccountDataSerializer();
        const [withdrawalRequest] = withdrawalRequestSerializer.deserialize(withdrawalRequestAccount.data);
        expect(withdrawalRequest).not.to.be.null;
    })

    it("should cancel a withdrawal request before window end time", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority, 6);

        // Create pair with 5% APY
        const apyBps = 500n;
        const intervalSeconds = hoursToSeconds(8);
        const intervalRate = calculateIntervalRateFromApy(apyBps, intervalSeconds);

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
        });

        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            owner: accessControl.authorities.depositAuthority.publicKey,
            mint: baseMint.mintKeypair.publicKey
        });

        // Mint tokens to staker and deposit authority
        const mintTx = await transactionBuilder()
            .add(
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
            )
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(mintTx));

        setPriceFeedTime(svm, 30)
        // Stake tokens
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: pair.lstTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            quantity: 100_000_000n,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(stakeTx));

        // Create withdrawal window with a short expiration time
        const startTime = addSeconds(currentTime, 1);
        const endTime = addDays(startTime, 1);
        const earliestWithdrawalTime = addDays(endTime, 1); // 1 day after end time
        const expirationTime = addDays(startTime, 30); // 30 days from start

        const [withdrawalWindowAddress] = findWithdrawalWindowPda(
            umi,
            pair.pairAddress,
            getUnixTime(startTime)
        );

        const windowLstAddress = findAssociatedTokenPda(umi, {
            mint: pair.lstAddress,
            owner: withdrawalWindowAddress
        })

        const [windowBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: withdrawalWindowAddress
        });

        const withdrawalWindowTx = await createWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            windowLstAccount: windowLstAddress,
            lstMint: pair.lstAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            startTime: getUnixTime(startTime),
            endTime: getUnixTime(endTime),
            earliestWithdrawalTime: getUnixTime(earliestWithdrawalTime),
            expirationTime: getUnixTime(expirationTime),
            maxWithdrawalAmount: 500_000_000,
            authority: accessControl.authorities.windowAuthority
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(withdrawalWindowTx));

        // Get window data
        const windowSerializer = getWithdrawalWindowAccountDataSerializer();
        const windowAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalWindowAddress));
        const [window] = windowSerializer.deserialize(windowAccount.data);

        // Request withdrawal
        const requestTime = addHours(fromUnixTime(Number(window.startTime)), 1);
        timeTravel(svm, requestTime);

        setPriceFeedTime(svm, 30)
        const requestedWithdrawalAmount = 50_000_000;
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
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const requestResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalRequestTx));
        // console.log(requestResult.toString())


        // cancel the request, assert that the user has lst amount - fees.

        const [withdrawalRequestAddress] = findWithdrawalRequestPda(umi, withdrawalWindowAddress, staker.publicKey);
        let withdrawalRequestSerializer = getWithdrawalRequestAccountDataSerializer();
        let withdrawalRequestAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress))
        let [withdrawalRequest] = withdrawalRequestSerializer.deserialize(withdrawalRequestAccount.data);

        expect(withdrawalRequest).not.to.be.null;

        const cancelWithdrawalRequestTx = await cancelWithdrawalRequest(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            staker: staker,
            lstMint: pair.lstAddress
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const cancelResult = svm.sendTransaction(toWeb3JsTransaction(cancelWithdrawalRequestTx))
        // console.log(cancelResult.toString())

        withdrawalRequestAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress))

        expect(withdrawalRequestAccount.data.length).to.equal(0);

        timeTravel(svm, addSeconds(requestTime, 1))

        setPriceFeedTime(svm, 30)
        // const requestedWithdrawalAmount = 50_000_000;
        const withdrawalRequestTx2 = await requestWithdraw(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            staker: staker,
            stakerLstAccount: stakerLstTokenAddress,
            lstMint: pair.lstAddress,
            accessControl: accessControl.accessControlAddress,
            // We have to do this to create some entropy
            // or lite svm will think it's the same transaction
            amount: requestedWithdrawalAmount + 1,
            merkleProof: none(),
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const request2Result = svm.sendTransaction(toWeb3JsTransaction(withdrawalRequestTx2));
        // console.log(request2Result.toString());


        withdrawalRequestAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress))
        let [withdrawalRequestAfter] = withdrawalRequestSerializer.deserialize(withdrawalRequestAccount.data);
        // amount minus withdrawal fee
        expect(Number(withdrawalRequestAfter.lstAmount)).to.equal(49500001)

    });

    it.skip("should close a withdrawal window", async () => { });

    it("should restake expired withdrawal and return tokens", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority, 6);

        // Create pair with 5% APY
        const apyBps = 500n;
        const intervalSeconds = hoursToSeconds(8);
        const intervalRate = calculateIntervalRateFromApy(apyBps, intervalSeconds);

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
            mint: pair.lstAddress,
            owner: staker.publicKey,
        });

        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: accessControl.authorities.depositAuthority.publicKey,
        });

        // Create pair base token account
        const [pairBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pair.pairAddress
        });

        // Mint tokens to staker and deposit authority
        const mintTx = await transactionBuilder()
            .add(
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
            )
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const mintResult = svm.sendTransaction(toWeb3JsTransaction(mintTx));
        // console.log(mintResult.toString());

        // Stake tokens
        setPriceFeedTime(svm, 30);
        const stakeAmount = 100_000_000n;
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: pair.lstTokenAddress,
            lstMint: pair.lstAddress,
            staker: staker,
            quantity: stakeAmount,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const stakeResult = svm.sendTransaction(toWeb3JsTransaction(stakeTx));
        // console.log(stakeResult.toString());

        // Create withdrawal window with a short expiration time
        const startTime = addSeconds(currentTime, 1);
        const endTime = addDays(startTime, 1);
        const earliestWithdrawalTime = addDays(endTime, 1); // 1 day after end time
        const expirationTime = addDays(startTime, 30); // 30 days from start

        const [withdrawalWindowAddress] = findWithdrawalWindowPda(
            umi,
            pair.pairAddress,
            getUnixTime(startTime)
        );

        const windowLstAddress = findAssociatedTokenPda(umi, {
            mint: pair.lstAddress,
            owner: withdrawalWindowAddress
        })

        const [windowBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: withdrawalWindowAddress
        });


        const withdrawalWindowTx = await createWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            windowLstAccount: windowLstAddress,
            lstMint: pair.lstAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            startTime: getUnixTime(startTime),
            endTime: getUnixTime(endTime),
            earliestWithdrawalTime: getUnixTime(earliestWithdrawalTime),
            expirationTime: getUnixTime(expirationTime),
            maxWithdrawalAmount: 500_000_000,
            authority: accessControl.authorities.windowAuthority
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const createWindowResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalWindowTx));
        // console.log(createWindowResult.toString());

        // Get window data
        const windowSerializer = getWithdrawalWindowAccountDataSerializer();
        const windowAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalWindowAddress));
        const [window] = windowSerializer.deserialize(windowAccount.data);

        // Request withdrawal
        const requestTime = addHours(fromUnixTime(Number(window.startTime)), 1);
        timeTravel(svm, requestTime);

        setPriceFeedTime(svm, 30);
        const requestedWithdrawalAmount = 50_000_000;
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
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const requestResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalRequestTx))
        // console.log("Request withdrawal result:", requestResult.toString());

        // Get the withdrawal request PDA
        const [withdrawalRequestAddress] = findWithdrawalRequestPda(
            umi,
            withdrawalWindowAddress,
            staker.publicKey
        );

        // Verify withdrawal request was created
        const withdrawalRequestSerializer = getWithdrawalRequestAccountDataSerializer();
        const withdrawalRequestAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress));
        const [withdrawalRequest] = withdrawalRequestSerializer.deserialize(withdrawalRequestAccount.data);

        // Get the amount of LST tokens burned during the request
        const lstAmountBurned = withdrawalRequest.lstAmount;
        const baseAmount = withdrawalRequest.baseAmount;

        expect(withdrawalRequest).not.to.be.null;
        expect(Number(lstAmountBurned)).to.be.approximately(requestedWithdrawalAmount * 0.99, 1000); // Account for withdrawal fee

        // Fund the withdrawal window
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
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const fundResult = svm.sendTransaction(toWeb3JsTransaction(fundTx));
        // console.log("Fund withdrawal window result:", fundResult.toString());

        // Verify window was funded
        const { amount: windowBaseBalance } = getTokenAccountData(svm, windowBaseTokenAddress);
        expect(Number(windowBaseBalance)).to.be.greaterThan(0);

        // Time travel past the expiration time
        const expiredTime = addDays(startTime, 31); // 31 days after start, expiration is 30 days
        timeTravel(svm, expiredTime);

        // Capture initial token balances
        const { amount: initialStakerLstBalance } = getTokenAccountData(svm, stakerLstTokenAddress);
        const { amount: initialWindowBaseBalance } = getTokenAccountData(svm, windowBaseTokenAddress);
        const { amount: initialPairBaseBalance } = getTokenAccountData(svm, pairBaseTokenAddress);


        // Execute restake expired withdrawal
        const restakeTx = await restakeExpiredWithdraw(umi, {
            pair: pair.pairAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            withdrawalRequest: withdrawalRequestAddress,
            rentReceiver: staker.publicKey,
            windowAuthority: accessControl.authorities.windowAuthority,
            stakerLstTokenAccount: stakerLstTokenAddress,
            pairBaseTokenAccount: pairBaseTokenAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            lstMint: pair.lstAddress,
            accessControl: accessControl.accessControlAddress
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const restakeResult = svm.sendTransaction(toWeb3JsTransaction(restakeTx));
        // console.log("Restake expired withdrawal result:", restakeResult.toString());

        // Verify withdrawal request is closed (account data length is 0)
        const closedWithdrawalRequestAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress));
        expect(closedWithdrawalRequestAccount.data.length).to.equal(0);

        // Capture final token balances
        const { amount: finalStakerLstBalance } = getTokenAccountData(svm, stakerLstTokenAddress);
        const { amount: finalWindowBaseBalance } = getTokenAccountData(svm, windowBaseTokenAddress);
        const { amount: finalPairBaseBalance } = getTokenAccountData(svm, pairBaseTokenAddress);

        // Verify LST tokens were re-minted to the staker
        expect(Number(finalStakerLstBalance)).to.equal(
            Number(initialStakerLstBalance) + Number(lstAmountBurned)
        );

        // Verify base tokens were transferred from window to pair
        expect(Number(finalWindowBaseBalance)).to.equal(
            Number(initialWindowBaseBalance) - Number(baseAmount)
        );

        expect(Number(finalPairBaseBalance)).to.equal(
            Number(initialPairBaseBalance) + Number(baseAmount)
        );
    });

    it.skip("should fail to cancel a withdrawal after window end time", async () => { });
    it.skip("should fail to cancel a withdrawal with wrong signer", async () => { });
    it.skip("should fail to create a window with wrong authority", async () => { });
    it.skip("should fund a window with the correct authority", async () => { });
    it.skip("should fail to fund a window with wrong authority", async () => { });
    // tested already in rates.test.ts
    it.skip("should process withdrawal requests correctly", async () => { });
});
