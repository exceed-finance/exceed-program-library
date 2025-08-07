import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint,
    createPairAccounts,
    timeTravel
} from "../helpers";
import { addDays, getUnixTime, hoursToSeconds, interval } from "date-fns";
import { getPairAccountDataSerializer, updatePairLimits, updatePairYield } from "../../clients/js/src/generated/liquid_staking";
import { calculateAnnualYieldBps, calculateExchangeRate, calculateIntervalRateFromApy, calculateLstExchangeRate, PRECISION, verifyIntervalRate } from "../../clients/js/src";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";

describe("pair-configuration", () => {
    it("should update pair limits", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            depositCap: 1_000_000_000n,
            minimumDeposit: 100_000n
        });

        // Update pair limits (deposit cap, minimum deposit, fees)
        const newDepositCap = 2_000_000_000n;
        const newMinimumDeposit = 200_000n;
        const newStakeFeeBps = 50; // 0.5%
        const newSwapFeeBps = 30; // 0.3%
        const newWithdrawFeeBps = 20; // 0.2%

        const updateLimitsTx = await updatePairLimits(env.umi, {
            pair: pair.pairAddress,
            authority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            depositCap: newDepositCap,
            minimumDeposit: newMinimumDeposit,
            stakeFeeBps: newStakeFeeBps,
            swapFeeBps: newSwapFeeBps,
            withdrawFeeBps: newWithdrawFeeBps
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const updateLimitsResult = env.svm.sendTransaction(toWeb3JsTransaction(updateLimitsTx));
        // console.log(updateLimitsResult.toString());

        // Verify limits were updated correctly
        const pairSerializer = getPairAccountDataSerializer();
        const pairAccount = env.svm.getAccount(toWeb3JsPublicKey(pair.pairAddress));
        const [updatedPair] = pairSerializer.deserialize(pairAccount.data);

        expect(updatedPair.depositCap).to.equal(newDepositCap);
        expect(updatedPair.minimumDeposit).to.equal(newMinimumDeposit);
        expect(updatedPair.stakeFeeBps).to.equal(newStakeFeeBps);
        expect(updatedPair.swapFeeBps).to.equal(newSwapFeeBps);
        expect(updatedPair.withdrawFeeBps).to.equal(newWithdrawFeeBps);
    });

    it("should update pair yield", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);

        const intervalSeconds = hoursToSeconds(8);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            intervalAprRate: calculateIntervalRateFromApy(500, intervalSeconds), // 5% APY with 8-hour intervals
            secondsPerInterval: intervalSeconds
        });

        // Update pair yield (intervalAprRate)
        const newApyBps = 1000n; // 10% APY
        const newIntervalRate = calculateIntervalRateFromApy(Number(newApyBps), Number(intervalSeconds));

        const updateYieldTx = await updatePairYield(env.umi, {
            pair: pair.pairAddress,
            authority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            intervalAprRate: newIntervalRate
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const updateYieldResult = env.svm.sendTransaction(toWeb3JsTransaction(updateYieldTx));
        // console.log(updateYieldResult.toString());

        // Verify yield was updated correctly
        const pairSerializer = getPairAccountDataSerializer();
        const pairAccount = env.svm.getAccount(toWeb3JsPublicKey(pair.pairAddress));
        const [updatedPair] = pairSerializer.deserialize(pairAccount.data);

        // Verify the calculated APY matches our target
        const verification = verifyIntervalRate(
            updatedPair.intervalAprRate,
            newApyBps,
            updatedPair.secondsPerInterval
        );


        expect(updatedPair.intervalAprRate).to.equal(newIntervalRate);
        expect(Number(verification.errorBps)).to.equal(0);
    });

    it("should update pair APY and verify calculations", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const intervalSeconds = hoursToSeconds(8);
        const initialInterval = calculateIntervalRateFromApy(500, intervalSeconds);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            intervalAprRate: initialInterval,
            secondsPerInterval: intervalSeconds
        });

        // Record initial exchange rate and timestamp
        const pairSerializer = getPairAccountDataSerializer();
        const initialPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pair.pairAddress));
        const [initialPair] = pairSerializer.deserialize(initialPairAccount.data);
        const initialTimestamp = env.currentTime;
        const initialExchangeRate = initialPair.lastYieldChangeExchangeRate;

        // Update pair APY to a new value
        const newApyBps = 1000n; // 10% APY
        const newIntervalRate = calculateIntervalRateFromApy(newApyBps, intervalSeconds);

        // Time travel to 30 days in the future
        const futureTime = addDays(initialTimestamp, 730);
        timeTravel(env.svm, futureTime);

        const updateYieldTx = await updatePairYield(env.umi, {
            pair: pair.pairAddress,
            authority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            intervalAprRate: newIntervalRate
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        const updateYieldResult = env.svm.sendTransaction(toWeb3JsTransaction(updateYieldTx));
        // console.log(updateYieldResult.toString());

        // Get the updated pair to verify the yield change
        const updatedPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pair.pairAddress));
        const [updatedPair] = pairSerializer.deserialize(updatedPairAccount.data);

        let expectedExchangeRate = calculateExchangeRate(
            updatedPair.lastYieldChangeTimestamp,
            getUnixTime(futureTime),
            updatedPair.intervalAprRate,
            updatedPair.lastYieldChangeExchangeRate,
            intervalSeconds
        )

        expect(Number(expectedExchangeRate)).to.equal(Number(updatedPair.lastYieldChangeExchangeRate));

    });

    it("should fail to update pair configuration with unauthorized authority", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        let intervalSeconds = hoursToSeconds(8);
        let intervalRate = calculateIntervalRateFromApy(500, intervalSeconds);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            depositCap: 1_000_000_000n,
            intervalAprRate: intervalRate
        });
        const unauthorizedUser = createUser(env.svm, env.umi);

        // Attempt to update pair configuration with unauthorized user
        const updateLimitsTx = await updatePairLimits(env.umi, {
            pair: pair.pairAddress,
            authority: unauthorizedUser,
            accessControl: accessControl.accessControlAddress,
            depositCap: 2_000_000_000n,
            minimumDeposit: null,
            stakeFeeBps: null,
            swapFeeBps: null,
            withdrawFeeBps: null
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(updateLimitsTx));

        const pairSerializer = getPairAccountDataSerializer();
        let updatedPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pair.pairAddress));
        let [updatedPair] = pairSerializer.deserialize(updatedPairAccount.data);

        expect(Number(updatedPair.depositCap)).to.equal(1_000_000_000);

        // Also try with updatePairYield
        const updateYieldTx = await updatePairYield(env.umi, {
            pair: pair.pairAddress,
            authority: unauthorizedUser,
            accessControl: accessControl.accessControlAddress,
            intervalAprRate: 1000089127990n // 10% APY
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(updateYieldTx));

        updatedPairAccount = env.svm.getAccount(toWeb3JsPublicKey(pair.pairAddress));
        let [updatedPair2] = pairSerializer.deserialize(updatedPairAccount.data);

        expect(Number(updatedPair2.intervalAprRate)).to.equal(Number(intervalRate));
    });
});
