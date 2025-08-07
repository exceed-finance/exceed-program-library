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
import { createAssociatedToken, findAssociatedTokenPda, mintTokensTo } from "@metaplex-foundation/mpl-toolbox";
import { none, transactionBuilder } from "@metaplex-foundation/umi";
import { fromWeb3JsPublicKey, toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { calculateIntervalRateFromApy } from "../../clients/js/src";
import {
    closeWithdrawalWindow,
    createWithdrawalWindow,
    executeWithdraw,
    fundWithdrawalWindow,
    getWithdrawalRequestAccountDataSerializer,
    getWithdrawalWindowAccountDataSerializer,
    requestWithdraw,
    stake
} from "../../clients/js/src/generated/liquid_staking";
import { findWithdrawalRequestPda, findWithdrawalWindowPda } from "../../clients/js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("liquid-staking: close withdrawal window", () => {
    it("should close a withdrawal window and transfer excess tokens", async () => {
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

        svm.sendTransaction(toWeb3JsTransaction(mintTx));


        setPriceFeedTime(svm, 30);
        // Stake tokens
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

        // Create withdrawal window
        const startTime = addSeconds(currentTime, 1);
        const endTime = addDays(startTime, 1);
        const earliestWithdrawalTime = addDays(endTime, 1); // 1 day after end time
        const expirationTime = addDays(startTime, 30); // 30 days from start

        const [withdrawalWindowAddress] = findWithdrawalWindowPda(
            umi,
            pair.pairAddress,
            getUnixTime(startTime)
        );

        const [windowBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: withdrawalWindowAddress
        });

        const [windowLstAddress] = findAssociatedTokenPda(umi, {
            mint: pair.lstAddress,
            owner: withdrawalWindowAddress
        });

        const withdrawalWindowTx = await createWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
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

        // Get the amount of base tokens to be withdrawn
        const baseAmount = withdrawalRequest.baseAmount;

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
        // console.log(fundResult.toString())

        // Execute withdrawal
        const withdrawalTime = addDays(fundTime, 2); // After earliest withdrawal time
        timeTravel(svm, withdrawalTime);
        setPriceFeedTime(svm, 30);

        const withdrawalTx = await executeWithdraw(umi, {
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstMint: pair.lstAddress,
            withdrawalWindow: withdrawalWindowAddress,
            windowLstAccount: windowLstAddress,
            windowBaseTokenAccount: windowBaseTokenAddress,
            withdrawalRequest: withdrawalRequestAddress,
            staker: staker,
            stakerBaseTokenAccount: stakerBaseTokenAddress,
            accessControl: accessControl.accessControlAddress,
            priceFeed: SOL_USD_FEED_ADDRESS
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const withdrawResult = svm.sendTransaction(toWeb3JsTransaction(withdrawalTx));
        // console.log(withdrawResult.toString())

        // Expect the withdrawal request to be closed
        const requestAccountAfter = svm.getAccount(toWeb3JsPublicKey(withdrawalRequestAddress))
        expect(requestAccountAfter.data.length).to.equal(0);
        expect(requestAccountAfter.lamports).to.equal(0);

        // Manually send additional base tokens to the window's base token account
        // This simulates tokens being sent outside the normal program flow
        const excessTokenAmount = 25_000_000;
        const sendExcessTokensTx = await transactionBuilder()
            .add(
                mintTokensTo(umi, {
                    token: windowBaseTokenAddress,
                    amount: excessTokenAmount,
                    mint: baseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const transferResult = svm.sendTransaction(toWeb3JsTransaction(sendExcessTokensTx));
        // console.log(transferResult.toString())

        // Verify the excess tokens were sent
        const { amount: windowBalanceAfterExcess } = getTokenAccountData(svm, windowBaseTokenAddress);
        expect(Number(windowBalanceAfterExcess)).to.equal(excessTokenAmount);

        // Get initial pair base token balance before closing the window
        const { amount: initialPairBaseBalance } = getTokenAccountData(svm, pairBaseTokenAddress);

        // Close the withdrawal window
        const closeWindowTx = await closeWithdrawalWindow(umi, {
            pair: pair.pairAddress,
            accessControl: accessControl.accessControlAddress,
            withdrawalWindow: withdrawalWindowAddress,
            pairBaseTokenAccount: pairBaseTokenAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            windowBaseTokenAccount: windowBaseTokenAddress,
            windowLstAccount: windowLstAddress,
            authority: accessControl.authorities.windowAuthority,
            tokenProgram: fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
            pairLstAccount: pair.lstTokenAddress,
            lstMint: pair.lstAddress,
        })
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        const closeResult = svm.sendTransaction(toWeb3JsTransaction(closeWindowTx));
        // console.log(closeResult.toString())

        // Verify the window account was closed
        const closedWindowAccount = svm.getAccount(toWeb3JsPublicKey(withdrawalWindowAddress));
        expect(closedWindowAccount.data.length).to.equal(0);

        // Verify the excess tokens were transferred to the pair base token account
        const { amount: finalPairBaseBalance } = getTokenAccountData(svm, pairBaseTokenAddress);
        expect(Number(finalPairBaseBalance)).to.equal(
            Number(initialPairBaseBalance) + excessTokenAmount
        );

        // Verify the window base token account is closed by checking if the account exists
        const windowBaseTokenAccountAfterClose = svm.getAccount(toWeb3JsPublicKey(windowBaseTokenAddress));
        expect(windowBaseTokenAccountAfterClose.data.length).to.equal(0);
    });
});
