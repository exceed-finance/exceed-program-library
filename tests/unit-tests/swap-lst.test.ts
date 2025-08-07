import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint,
    createPairAccounts,
    getTokenAccountData,
    timeTravel,
    setPriceFeedTime,
    SOL_USD_FEED_ADDRESS
} from "../helpers";
import { createAssociatedToken, findAssociatedTokenPda, mintTokensTo } from "@metaplex-foundation/mpl-toolbox";
import { signerIdentity, transactionBuilder } from "@metaplex-foundation/umi";
import { stake, swapLst, sealProgram, manageGuardian } from "../../clients/js/src/generated/liquid_staking";
import { fromWeb3JsPublicKey, toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { addDays, hoursToSeconds } from "date-fns";
import { calculateIntervalRateFromApy, PRECISION } from "../../clients/js";
import { NATIVE_MINT } from "@solana/spl-token";
import { keccak_256 } from "@noble/hashes/sha3";

describe("swap-lst", () => {
    it("should swap between two LST tokens with the same base token", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority, 4);


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
            secondsPerInterval: intervalSeconds,
            swapFeeBps: 0,
            depositCap: 1_000_000_000_000n
        });


        const pair2 = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "PAIRTWO",
            intervalAprRate: intervalRate,
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: Number(PRECISION * 10n),
            swapFeeBps: 0,
            depositCap: 1_000_000_000_000n
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
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const stakeResult = svm.sendTransaction(toWeb3JsTransaction(stakeTx))
        // console.log(stakeResult.toString())

        let stakerLstTokenBefore = getTokenAccountData(svm, stakerLstTokenAddress);


        const swapTx = await swapLst(umi, {
            sourcePair: pair.pairAddress,
            sourceLstMint: pair.lstAddress,
            sourceLstFeeAccount: pair.lstTokenAddress,
            destinationPair: pair2.pairAddress,
            destinationLstMint: pair2.lstAddress,
            destinationLstFeeAccount: pair2.lstTokenAddress,
            user: staker,
            accessControl: accessControl.accessControlAddress,
            quantity: 100_000_000,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)

        const swapResult = svm.sendTransaction(toWeb3JsTransaction(swapTx));
        // console.log(swapResult.toString());

        const [stakerLst2Addres] = findAssociatedTokenPda(umi, {
            owner: staker.publicKey,
            mint: pair2.lstAddress
        });

        const stakerLst2Token = getTokenAccountData(svm, stakerLst2Addres);
        // console.log(stakerLst2Token)

        expect(Number(stakerLst2Token.amount)).to.equal(Number(stakerLstTokenBefore.amount) / 10);
    });
    it.skip("should fail to swap with mismatched base token mints", async () => {
    });

    it("should fail to swap with zero quantity or below minimum deposit", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority, 4);

        // Create source pair with low minimum deposit
        const sourcePair = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "SOURCE",
            minimumDeposit: 100_000n, // Low minimum deposit
            depositCap: 1_000_000_000_000n
        });

        // Create destination pair with high minimum deposit
        const destinationPair = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "DEST",
            minimumDeposit: 10_000_000n, // High minimum deposit
            depositCap: 1_000_000_000_000n
        });

        // Create staker and stake tokens
        const staker = createUser(svm, umi);

        const [stakerSourceLstTokenAddress] = findAssociatedTokenPda(umi, {
            owner: staker.publicKey,
            mint: sourcePair.lstAddress
        });

        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            owner: accessControl.authorities.depositAuthority.publicKey,
            mint: baseMint.mintKeypair.publicKey
        });

        // Setup token accounts and mint tokens
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
            ).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(mintTx));

        setPriceFeedTime(svm, 30)
        // Stake tokens to source pair
        const stakeAmount = 100_000_000n;
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: sourcePair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: sourcePair.lstTokenAddress,
            lstMint: sourcePair.lstAddress,
            staker: staker,
            quantity: stakeAmount,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const stakeResult = svm.sendTransaction(toWeb3JsTransaction(stakeTx));
        // console.log(stakeResult.toString())

        // Create destination token account if it doesn't exist
        const [stakerDestLstTokenAddress] = findAssociatedTokenPda(umi, {
            owner: staker.publicKey,
            mint: destinationPair.lstAddress
        });

        const createDestTokenTx = await transactionBuilder()
            .add(
                createAssociatedToken(umi, {
                    owner: staker.publicKey,
                    mint: destinationPair.lstAddress
                })
            )
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(createDestTokenTx));

        // Capture state before transactions
        const sourceLstBalanceBefore = getTokenAccountData(svm, stakerSourceLstTokenAddress).amount;
        const destLstBalanceBefore = getTokenAccountData(svm, stakerDestLstTokenAddress).amount;

        // Get pair states before transactions
        const sourcePairBefore = { ...sourcePair.pair };
        const destPairBefore = { ...destinationPair.pair };

        setPriceFeedTime(svm, 30)
        // Test zero quantity swap (should fail)
        const zeroSwapTx = await swapLst(umi, {
            sourcePair: sourcePair.pairAddress,
            sourceLstMint: sourcePair.lstAddress,
            sourceLstFeeAccount: sourcePair.lstTokenAddress,
            destinationPair: destinationPair.pairAddress,
            destinationLstMint: destinationPair.lstAddress,
            destinationLstFeeAccount: destinationPair.lstTokenAddress,
            user: staker,
            accessControl: accessControl.accessControlAddress,
            quantity: 0, // Zero quantity
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const zeroSwapResult = svm.sendTransaction(toWeb3JsTransaction(zeroSwapTx));
        // console.log(zeroSwapResult.toString())

        // Verify state hasn't changed after zero quantity swap
        const sourceLstBalanceAfterZeroSwap = getTokenAccountData(svm, stakerSourceLstTokenAddress).amount;
        const destLstBalanceAfterZeroSwap = getTokenAccountData(svm, stakerDestLstTokenAddress).amount;

        expect(sourceLstBalanceAfterZeroSwap).to.equal(sourceLstBalanceBefore);
        expect(destLstBalanceAfterZeroSwap).to.equal(destLstBalanceBefore);

        // Test below minimum deposit swap (should fail)
        // The amount needs to be small enough that when converted to base tokens,
        // it will be below the destination pair's minimum deposit
        const smallSwapAmount = 1_000_000; // This should convert to less than 10_000_000 base tokens

        setPriceFeedTime(svm, 30)
        const smallSwapTx = await swapLst(umi, {
            sourcePair: sourcePair.pairAddress,
            sourceLstMint: sourcePair.lstAddress,
            sourceLstFeeAccount: sourcePair.lstTokenAddress,
            destinationPair: destinationPair.pairAddress,
            destinationLstMint: destinationPair.lstAddress,
            destinationLstFeeAccount: destinationPair.lstTokenAddress,
            user: staker,
            accessControl: accessControl.accessControlAddress,
            quantity: smallSwapAmount,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const smallSwapResult = svm.sendTransaction(toWeb3JsTransaction(smallSwapTx));
        // console.log(smallSwapResult.toString())

        // Verify state hasn't changed after small swap
        const sourceLstBalanceAfterSmallSwap = getTokenAccountData(svm, stakerSourceLstTokenAddress).amount;
        const destLstBalanceAfterSmallSwap = getTokenAccountData(svm, stakerDestLstTokenAddress).amount;

        expect(sourceLstBalanceAfterSmallSwap).to.equal(sourceLstBalanceBefore);
        expect(destLstBalanceAfterSmallSwap).to.equal(destLstBalanceBefore);
    });

    it("should fail to swap when exceeding deposit cap", async () => {
        // Setup
        const { umi, svm, currentTime } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority, 4);

        // Create source pair with high deposit cap
        const sourcePair = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "SOURCE",
            depositCap: 1_000_000_000_000n // High deposit cap
        });

        // Create destination pair with low deposit cap
        const destinationPair = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "DEST",
            depositCap: 50_000_000n // Low deposit cap
        });

        // Create staker and stake tokens
        const staker = createUser(svm, umi);

        const [stakerSourceLstTokenAddress] = findAssociatedTokenPda(umi, {
            owner: staker.publicKey,
            mint: sourcePair.lstAddress
        });

        const [stakerBaseTokenAddress] = findAssociatedTokenPda(umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        const [depositAuthorityBaseTokenAddress] = findAssociatedTokenPda(umi, {
            owner: accessControl.authorities.depositAuthority.publicKey,
            mint: baseMint.mintKeypair.publicKey
        });

        // Setup token accounts and mint tokens
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
            ).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(mintTx));

        setPriceFeedTime(svm, 30)
        // Stake tokens to source pair
        const stakeAmount = 100_000_000n;
        const stakeTx = await stake(umi, {
            accessControl: accessControl.accessControlAddress,
            pair: sourcePair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstFeeAccount: sourcePair.lstTokenAddress,
            lstMint: sourcePair.lstAddress,
            staker: staker,
            quantity: stakeAmount,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(stakeTx));

        // Create destination token account if it doesn't exist
        const [stakerDestLstTokenAddress] = findAssociatedTokenPda(umi, {
            owner: staker.publicKey,
            mint: destinationPair.lstAddress
        });

        const createDestTokenTx = await transactionBuilder()
            .add(
                createAssociatedToken(umi, {
                    owner: staker.publicKey,
                    mint: destinationPair.lstAddress
                })
            )
            .setBlockhash(svm.latestBlockhash())
            .buildAndSign(umi);

        svm.sendTransaction(toWeb3JsTransaction(createDestTokenTx));

        // Capture state before transactions
        const sourceLstBalanceBefore = getTokenAccountData(svm, stakerSourceLstTokenAddress).amount;
        const destLstBalanceBefore = getTokenAccountData(svm, stakerDestLstTokenAddress).amount;

        // Get pair states before transactions
        const sourcePairBefore = { ...sourcePair.pair };
        const destPairBefore = { ...destinationPair.pair };

        // Test swap that would exceed deposit cap (should fail)
        const largeSwapAmount = 80_000_000; // This should convert to more than the destination pair's deposit cap

        setPriceFeedTime(svm, 30)
        const largeSwapTx = await swapLst(umi, {
            sourcePair: sourcePair.pairAddress,
            sourceLstMint: sourcePair.lstAddress,
            sourceLstFeeAccount: sourcePair.lstTokenAddress,
            destinationPair: destinationPair.pairAddress,
            destinationLstMint: destinationPair.lstAddress,
            destinationLstFeeAccount: destinationPair.lstTokenAddress,
            user: staker,
            accessControl: accessControl.accessControlAddress,
            quantity: largeSwapAmount,
            merkleProof: null,
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const largeSwapResult = svm.sendTransaction(toWeb3JsTransaction(largeSwapTx));
        // console.log(largeSwapResult.toString())

        // Verify state hasn't changed
        const sourceLstBalanceAfterLargeSwap = getTokenAccountData(svm, stakerSourceLstTokenAddress).amount;
        const destLstBalanceAfterLargeSwap = getTokenAccountData(svm, stakerDestLstTokenAddress).amount;

        expect(sourceLstBalanceAfterLargeSwap).to.equal(sourceLstBalanceBefore);
        expect(destLstBalanceAfterLargeSwap).to.equal(destLstBalanceBefore);
    });

    it.skip("should fail to swap when program is sealed", async () => {
    });

    it.skip("should swap between LSTs with different exchange rates", async () => {
    });
});
