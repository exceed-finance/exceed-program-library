import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint
} from "../helpers";
import {
    getPairAccountDataSerializer,
    updatePairYield,
    createPair
} from "../../clients/js/src/generated/liquid_staking";
import { calculateIntervalRateFromApy, PRECISION, findLstPda, findPairPda } from "../../clients/js/src";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { hoursToSeconds } from "date-fns";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";

describe("pair-validation", () => {
    // Test for create_pair validation
    it("should validate parameters when creating a pair", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const intervalSeconds = hoursToSeconds(8);
        const tokenProgramId = fromWeb3JsPublicKey(TOKEN_PROGRAM_ID);

        // Test 1: Create a pair with interval_apr_rate = PRECISION (should succeed - zero yield)
        const symbol1 = "ZEROY";
        const [lstAddress1] = findLstPda(env.umi, symbol1);
        const [pairAddress1] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, lstAddress1);
        const [lstTokenAddress1] = findAssociatedTokenPda(env.umi, {
            mint: lstAddress1,
            owner: pairAddress1,
            tokenProgramId,
        });
        const [baseTokenAddress1] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pairAddress1,
            tokenProgramId,
        });

        // Attempt to create the pair with zero yield
        const createPairTx1 = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: pairAddress1,
            lstMint: lstAddress1,
            symbol: symbol1,
            intervalAprRate: PRECISION, // Equal to PRECISION (zero yield - should succeed)
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: PRECISION,
            depositCap: 1_000_000_000n,
            minimumDeposit: 100_000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: baseTokenAddress1,
            lstFeeAccount: lstTokenAddress1
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(createPairTx1));

        // Verify the pair was created successfully
        const pairSerializer1 = getPairAccountDataSerializer();
        const pairAccount1 = env.svm.getAccount(toWeb3JsPublicKey(pairAddress1));
        const [pair1] = pairSerializer1.deserialize(pairAccount1.data);

        expect(pair1.intervalAprRate).to.equal(PRECISION); // Zero yield
        expect(pair1.initialExchangeRate > 0).to.be.true;

        // Test 2: Try to create a pair with interval_apr_rate < PRECISION (should fail)
        const symbol2 = "INVALID2";
        const [lstAddress2] = findLstPda(env.umi, symbol2);
        const [pairAddress2] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, lstAddress2);
        const [lstTokenAddress2] = findAssociatedTokenPda(env.umi, {
            mint: lstAddress2,
            owner: pairAddress2,
            tokenProgramId,
        });
        const [baseTokenAddress2] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pairAddress2,
            tokenProgramId,
        });

        // Attempt to create the pair
        const createPairTx2 = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: pairAddress2,
            lstMint: lstAddress2,
            symbol: symbol2,
            intervalAprRate: PRECISION - 1n, // Less than PRECISION (should fail)
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: PRECISION,
            depositCap: 1_000_000_000n,
            minimumDeposit: 100_000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: baseTokenAddress2,
            lstFeeAccount: lstTokenAddress2
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(createPairTx2));

        // Check if the pair account exists - it shouldn't if validation failed
        const maybePair2 = env.svm.getAccount(toWeb3JsPublicKey(pairAddress2));
        expect(maybePair2).to.be.null;

        // Test 3: Try to create a pair with interval_apr_rate > MAX_INTERVAL_APR_RATE (should fail)
        const MAX_INTERVAL_APR_RATE = 1_000_000_000_000_000n;
        const symbol3 = "INVALID3";
        const [lstAddress3] = findLstPda(env.umi, symbol3);
        const [pairAddress3] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, lstAddress3);
        const [lstTokenAddress3] = findAssociatedTokenPda(env.umi, {
            mint: lstAddress3,
            owner: pairAddress3,
            tokenProgramId,
        });
        const [baseTokenAddress3] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pairAddress3,
            tokenProgramId,
        });

        // Attempt to create the pair
        const createPairTx3 = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: pairAddress3,
            lstMint: lstAddress3,
            symbol: symbol3,
            intervalAprRate: MAX_INTERVAL_APR_RATE + 1n, // Greater than MAX (should fail)
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: PRECISION,
            depositCap: 1_000_000_000n,
            minimumDeposit: 100_000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: baseTokenAddress3,
            lstFeeAccount: lstTokenAddress3
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const pairResult = env.svm.sendTransaction(toWeb3JsTransaction(createPairTx3));
        // console.log(pairResult.toString())

        // Check if the pair account exists - it shouldn't if validation failed
        const maybePair3 = env.svm.getAccount(toWeb3JsPublicKey(pairAddress3));
        expect(maybePair3).to.be.null;

        // Test 4: Try to create a pair with initial_exchange_rate = 0 (should fail)
        const symbol4 = "INVALID4";
        const [lstAddress4] = findLstPda(env.umi, symbol4);
        const [pairAddress4] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, lstAddress4);
        const [lstTokenAddress4] = findAssociatedTokenPda(env.umi, {
            mint: lstAddress4,
            owner: pairAddress4,
            tokenProgramId,
        });
        const [baseTokenAddress4] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pairAddress4,
            tokenProgramId,
        });

        // Attempt to create the pair
        const createPairTx4 = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: pairAddress4,
            lstMint: lstAddress4,
            symbol: symbol4,
            intervalAprRate: calculateIntervalRateFromApy(500, intervalSeconds),
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: 0, // Zero initial exchange rate (should fail)
            depositCap: 1_000_000_000n,
            minimumDeposit: 100_000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: baseTokenAddress4,
            lstFeeAccount: lstTokenAddress4
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const pair4Result = env.svm.sendTransaction(toWeb3JsTransaction(createPairTx4));
        // console.log(pair4Result.toString())

        // Check if the pair account exists - it shouldn't if validation failed
        const maybePair4 = env.svm.getAccount(toWeb3JsPublicKey(pairAddress4));
        expect(maybePair4).to.be.null;

        // Test 5: Try to create a pair with deposit_cap = 0 (should fail)
        const symbol5 = "INVALID5";
        const [lstAddress5] = findLstPda(env.umi, symbol5);
        const [pairAddress5] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, lstAddress5);
        const [lstTokenAddress5] = findAssociatedTokenPda(env.umi, {
            mint: lstAddress5,
            owner: pairAddress5,
            tokenProgramId,
        });
        const [baseTokenAddress5] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pairAddress5,
            tokenProgramId,
        });

        // Attempt to create the pair
        const createPairTx5 = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: pairAddress5,
            lstMint: lstAddress5,
            symbol: symbol5,
            intervalAprRate: calculateIntervalRateFromApy(500, intervalSeconds),
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: PRECISION,
            depositCap: 0n, // Zero deposit cap (should fail)
            minimumDeposit: 100_000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: baseTokenAddress5,
            lstFeeAccount: lstTokenAddress5
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const pair5Result = env.svm.sendTransaction(toWeb3JsTransaction(createPairTx5));
        // console.log(pair5Result.toString())

        // Check if the pair account exists - it shouldn't if validation failed
        const maybePair5 = env.svm.getAccount(toWeb3JsPublicKey(pairAddress5));
        expect(maybePair5).to.be.null;

        // Test 6: Try to create a pair with minimum_deposit > deposit_cap (should fail)
        const symbol6 = "INVALID6";
        const [lstAddress6] = findLstPda(env.umi, symbol6);
        const [pairAddress6] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, lstAddress6);
        const [lstTokenAddress6] = findAssociatedTokenPda(env.umi, {
            mint: lstAddress6,
            owner: pairAddress6,
            tokenProgramId,
        });
        const [baseTokenAddress6] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pairAddress6,
            tokenProgramId,
        });

        // Attempt to create the pair
        const createPairTx6 = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: pairAddress6,
            lstMint: lstAddress6,
            symbol: symbol6,
            intervalAprRate: calculateIntervalRateFromApy(500, intervalSeconds),
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: PRECISION,
            depositCap: 1_000_000n,
            minimumDeposit: 2_000_000n, // Greater than deposit_cap (should fail)
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: baseTokenAddress6,
            lstFeeAccount: lstTokenAddress6
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const pair6Result = env.svm.sendTransaction(toWeb3JsTransaction(createPairTx6));
        // console.log(pair6Result.toString())

        // Check if the pair account exists - it shouldn't if validation failed
        const maybePair6 = env.svm.getAccount(toWeb3JsPublicKey(pairAddress6));
        expect(maybePair6).to.be.null;

        // Test 7: Create a valid pair (should succeed)
        const validSymbol = "VALID";
        const [validLstAddress] = findLstPda(env.umi, validSymbol);
        const [validPairAddress] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, validLstAddress);
        const [validLstTokenAddress] = findAssociatedTokenPda(env.umi, {
            mint: validLstAddress,
            owner: validPairAddress,
            tokenProgramId,
        });
        const [validBaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: validPairAddress,
            tokenProgramId,
        });

        // Create a valid pair
        const createValidPairTx = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: validPairAddress,
            lstMint: validLstAddress,
            symbol: validSymbol,
            intervalAprRate: calculateIntervalRateFromApy(500, intervalSeconds),
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: PRECISION,
            depositCap: 1_000_000_000n,
            minimumDeposit: 100_000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: validBaseTokenAddress,
            lstFeeAccount: validLstTokenAddress
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const validPairResult = env.svm.sendTransaction(toWeb3JsTransaction(createValidPairTx));
        // console.log(validPairResult.toString())

        // Verify the pair was created successfully
        const pairSerializer = getPairAccountDataSerializer();
        const pairAccount = env.svm.getAccount(toWeb3JsPublicKey(validPairAddress));
        const [pair] = pairSerializer.deserialize(pairAccount.data);

        expect(pair.intervalAprRate > PRECISION).to.be.true;
        expect(pair.intervalAprRate <= 1_000_000_000_000_000n).to.be.true;
        expect(pair.initialExchangeRate > 0).to.be.true;
        expect(pair.depositCap > 0n).to.be.true;
        expect(pair.minimumDeposit <= pair.depositCap).to.be.true;
    });

    // Test for update_pair_yield validation
    it("should validate parameters when updating pair yield", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const intervalSeconds = hoursToSeconds(8);
        const tokenProgramId = fromWeb3JsPublicKey(TOKEN_PROGRAM_ID);

        // Create a valid pair first
        const symbol = "VALID";
        const [lstAddress] = findLstPda(env.umi, symbol);
        const [pairAddress] = findPairPda(env.umi, baseMint.mintKeypair.publicKey, lstAddress);
        const [lstTokenAddress] = findAssociatedTokenPda(env.umi, {
            mint: lstAddress,
            owner: pairAddress,
            tokenProgramId,
        });
        const [baseTokenAddress] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: pairAddress,
            tokenProgramId,
        });

        // Create a valid pair
        const intervalRate = calculateIntervalRateFromApy(500, intervalSeconds);
        const createPairTx = await createPair(env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            pair: pairAddress,
            lstMint: lstAddress,
            symbol: symbol,
            intervalAprRate: intervalRate,
            secondsPerInterval: intervalSeconds,
            initialExchangeRate: PRECISION,
            depositCap: 1_000_000_000n,
            minimumDeposit: 100_000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: tokenProgramId,
            pairBaseTokenAccount: baseTokenAddress,
            lstFeeAccount: lstTokenAddress
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(createPairTx));

        // Get initial state
        const pairSerializer = getPairAccountDataSerializer();
        const initialPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pairAddress));
        const [initialPair] = pairSerializer.deserialize(initialPairAccount.data);
        const initialIntervalAprRate = initialPair.intervalAprRate;

        // Test 1: Update with interval_apr_rate = PRECISION (should succeed - zero yield)
        const updateTx1 = await updatePairYield(env.umi, {
            pair: pairAddress,
            authority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            intervalAprRate: PRECISION
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const update1Result = env.svm.sendTransaction(toWeb3JsTransaction(updateTx1));
        // console.log(update1Result.toString())

        // Verify state - pair should be updated to zero yield
        let updatedPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pairAddress));
        let [updatedPair] = pairSerializer.deserialize(updatedPairAccount.data);

        expect(updatedPair.intervalAprRate).to.equal(PRECISION); // Zero yield

        // Test 2: Try to update with interval_apr_rate < PRECISION (should fail)
        const updateTx2 = await updatePairYield(env.umi, {
            pair: pairAddress,
            authority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            intervalAprRate: PRECISION - 1n
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const updateResult = env.svm.sendTransaction(toWeb3JsTransaction(updateTx2));
        // console.log(updateResult.toString())

        // Verify state - pair should not be updated
        updatedPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pairAddress));
        [updatedPair] = pairSerializer.deserialize(updatedPairAccount.data);

        expect(updatedPair.intervalAprRate).to.equal(PRECISION);

        // Test 3: Try to update with interval_apr_rate > MAX_INTERVAL_APR_RATE (should fail)
        const MAX_INTERVAL_APR_RATE = 1_000_000_000_000_000n;
        const updateTx3 = await updatePairYield(env.umi, {
            pair: pairAddress,
            authority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            intervalAprRate: MAX_INTERVAL_APR_RATE + 1n
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const update3Result = env.svm.sendTransaction(toWeb3JsTransaction(updateTx3));
        // console.log(update3Result.toString())

        // Verify state - pair should not be updated
        updatedPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pairAddress));
        [updatedPair] = pairSerializer.deserialize(updatedPairAccount.data);

        expect(updatedPair.intervalAprRate).to.equal(PRECISION);

        // Test 4: Update with valid interval_apr_rate (should succeed)
        const newApyBps = 1000n; // 10% APY
        const newIntervalRate = calculateIntervalRateFromApy(Number(newApyBps), Number(intervalSeconds));

        const updateTx4 = await updatePairYield(env.umi, {
            pair: pairAddress,
            authority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            intervalAprRate: newIntervalRate
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(updateTx4));

        // Verify state - pair should be updated
        updatedPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pairAddress));
        [updatedPair] = pairSerializer.deserialize(updatedPairAccount.data);

        expect(updatedPair.intervalAprRate).to.equal(newIntervalRate);
    });
});
