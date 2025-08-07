import { expect } from "chai";
import { addDays, addSeconds, getUnixTime } from "date-fns";
import { signerIdentity, unwrapOption } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import {
    initializeSale,
    updateSale,
    getSaleAccountDataSerializer
} from "../../clients/js/src/generated/early_purchase";
import {
    createTestEnvironment,
    createUser,
    createConfigAccount,
    createGuardianAccount,
    createSaleAccount,
    createTestMint,
    updateSaleAccount,
    findSalePda
} from "../helpers";

// Constants from Rust code
const MIN_SALE_DURATION = 300; // 5 minutes in seconds
const MAX_FUTURE_START_TIME = 31536000; // 1 year in seconds
const MAX_SALE_ID = 1_000_000;

describe("early-purchase: sale validation", () => {
    // Sale Initialization Validation Tests
    describe("initialization validation", () => {
        it("should fail to initialize a sale with zero payment amount", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Find sale PDA
            const saleId = 1;
            const [saleAddress] = findSalePda(env.umi, saleId);

            // Attempt to initialize sale with zero payment amount
            env.umi.use(signerIdentity(admin));
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const initializeSaleTx = await initializeSale(env.umi, {
                admin,
                sale: saleAddress,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                id: saleId,
                paymentAmount: 0n, // Invalid: zero payment amount
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: true,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(startTime)),
                endTimestamp: BigInt(getUnixTime(endTime))
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));

            // Verify sale account was not created
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            expect(saleAccount).to.be.null;
        });

        it("should fail to initialize a sale with zero max price feed age", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Find sale PDA
            const saleId = 1;
            const [saleAddress] = findSalePda(env.umi, saleId);

            // Attempt to initialize sale with zero max price feed age
            env.umi.use(signerIdentity(admin));
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const initializeSaleTx = await initializeSale(env.umi, {
                admin,
                sale: saleAddress,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                id: saleId,
                paymentAmount: 1000000n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 0n, // Invalid: zero max price feed age
                guardPurchases: true,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(startTime)),
                endTimestamp: BigInt(getUnixTime(endTime))
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));

            // Verify sale account was not created
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            expect(saleAccount).to.be.null;
        });

        it("should fail to initialize a sale with max_tokens_per_user > max_tokens_total", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Find sale PDA
            const saleId = 1;
            const [saleAddress] = findSalePda(env.umi, saleId);

            // Attempt to initialize sale with max_tokens_per_user > max_tokens_total
            env.umi.use(signerIdentity(admin));
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const initializeSaleTx = await initializeSale(env.umi, {
                admin,
                sale: saleAddress,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                id: saleId,
                paymentAmount: 1000000n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: true,
                maxTokensTotal: 1000000n, // 1 million
                maxTokensPerUser: 2000000n, // 2 million - Invalid: greater than max_tokens_total
                startTimestamp: BigInt(getUnixTime(startTime)),
                endTimestamp: BigInt(getUnixTime(endTime))
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));

            // Verify sale account was not created
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            expect(saleAccount).to.be.null;
        });

        it("should fail to initialize a sale with end time before start time", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Find sale PDA
            const saleId = 1;
            const [saleAddress] = findSalePda(env.umi, saleId);

            // Attempt to initialize sale with end time before start time
            env.umi.use(signerIdentity(admin));
            const startTime = addDays(env.currentTime, 7); // Start time is 7 days in the future
            const endTime = addDays(env.currentTime, 1); // End time is 1 day in the future - Invalid: before start time

            const initializeSaleTx = await initializeSale(env.umi, {
                admin,
                sale: saleAddress,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                id: saleId,
                paymentAmount: 1000000n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: true,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(startTime)),
                endTimestamp: BigInt(getUnixTime(endTime))
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));

            // Verify sale account was not created
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            expect(saleAccount).to.be.null;
        });

        it("should fail to initialize a sale with duration less than MIN_SALE_DURATION", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Find sale PDA
            const saleId = 1;
            const [saleAddress] = findSalePda(env.umi, saleId);

            // Attempt to initialize sale with duration less than MIN_SALE_DURATION
            env.umi.use(signerIdentity(admin));
            const startTime = addDays(env.currentTime, 1);
            const endTime = addSeconds(startTime, MIN_SALE_DURATION - 1); // Invalid: duration too short

            const initializeSaleTx = await initializeSale(env.umi, {
                admin,
                sale: saleAddress,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                id: saleId,
                paymentAmount: 1000000n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: true,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(startTime)),
                endTimestamp: BigInt(getUnixTime(endTime))
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));

            // Verify sale account was not created
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            expect(saleAccount).to.be.null;
        });

        it("should fail to initialize a sale with start time too far in the future", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Find sale PDA
            const saleId = 1;
            const [saleAddress] = findSalePda(env.umi, saleId);

            // Attempt to initialize sale with start time too far in the future
            env.umi.use(signerIdentity(admin));

            // Calculate a start time that's beyond MAX_FUTURE_START_TIME
            const currentTimestamp = getUnixTime(env.currentTime);
            const tooFarStartTime = new Date((currentTimestamp + MAX_FUTURE_START_TIME + 1) * 1000);
            const endTime = addDays(tooFarStartTime, 7);

            const initializeSaleTx = await initializeSale(env.umi, {
                admin,
                sale: saleAddress,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                id: saleId,
                paymentAmount: 1000000n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: true,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(tooFarStartTime)),
                endTimestamp: BigInt(getUnixTime(endTime))
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));

            // Verify sale account was not created
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            expect(saleAccount).to.be.null;
        });

        it("should fail to initialize a sale with ID > MAX_SALE_ID", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Find sale PDA with ID > MAX_SALE_ID
            const saleId = MAX_SALE_ID + 1;
            const [saleAddress] = findSalePda(env.umi, saleId);

            // Attempt to initialize sale with ID > MAX_SALE_ID
            env.umi.use(signerIdentity(admin));
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const initializeSaleTx = await initializeSale(env.umi, {
                admin,
                sale: saleAddress,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                id: saleId, // Invalid: ID > MAX_SALE_ID
                paymentAmount: 1000000n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: true,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(startTime)),
                endTimestamp: BigInt(getUnixTime(endTime))
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));

            // Verify sale account was not created
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            expect(saleAccount).to.be.null;
        });
    });

    // Sale Update Validation Tests
    describe("update validation", () => {
        it("should fail to update a sale with zero payment amount", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Create guardian account with update_sale permission
            const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
                env.svm,
                env.umi,
                admin,
                configAddress,
                {
                    updateConfig: false,
                    verifyPurchases: false,
                    depositTokens: false,
                    manageGuardians: false,
                    endSale: false,
                    updateSale: true,
                    withdrawFunds: false
                }
            );

            // Create valid sale account
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const { saleAddress, sale } = await createSaleAccount(
                env.svm,
                env.umi,
                {
                    admin,
                    purchaseMint: purchaseMint.mintKeypair.publicKey,
                    paymentMint: paymentMint.mintKeypair.publicKey,
                    paymentAmount: 1000000n,
                    priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                    maxPriceFeedAge: 300n,
                    guardPurchases: true,
                    maxTokensTotal: 1000000000n,
                    maxTokensPerUser: 10000000n,
                    startTimestamp: BigInt(getUnixTime(startTime)),
                    endTimestamp: BigInt(getUnixTime(endTime))
                }
            );

            // Capture the initial sale data
            const saleAccountBefore = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const saleSerializer = getSaleAccountDataSerializer();
            const [saleBefore] = saleSerializer.deserialize(saleAccountBefore.data);

            // Attempt to update sale with zero payment amount
            env.umi.use(signerIdentity(guardianAuthority));

            const updateSaleTx = await updateSale(env.umi, {
                authority: guardianAuthority,
                guardian: guardianAddress,
                sale: saleAddress,
                paymentAmount: 0n, // Invalid: zero payment amount
                guardPurchases: null,
                maxTokensTotal: null,
                maxTokensPerUser: null,
                startTimestamp: null,
                endTimestamp: null,
                maxPriceFeedAge: null
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(updateSaleTx));

            // Verify the sale data remains unchanged
            const saleAccountAfter = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const [saleAfter] = saleSerializer.deserialize(saleAccountAfter.data);

            // Assert that payment amount is unchanged
            expect(saleAfter.paymentAmount).to.equal(saleBefore.paymentAmount);
        });

        it("should fail to update a sale with max_tokens_per_user > max_tokens_total", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Create guardian account with update_sale permission
            const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
                env.svm,
                env.umi,
                admin,
                configAddress,
                {
                    updateConfig: false,
                    verifyPurchases: false,
                    depositTokens: false,
                    manageGuardians: false,
                    endSale: false,
                    updateSale: true,
                    withdrawFunds: false
                }
            );

            // Create valid sale account
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const { saleAddress, sale } = await createSaleAccount(
                env.svm,
                env.umi,
                {
                    admin,
                    purchaseMint: purchaseMint.mintKeypair.publicKey,
                    paymentMint: paymentMint.mintKeypair.publicKey,
                    paymentAmount: 1000000n,
                    priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                    maxPriceFeedAge: 300n,
                    guardPurchases: true,
                    maxTokensTotal: 1000000000n,
                    maxTokensPerUser: 10000000n,
                    startTimestamp: BigInt(getUnixTime(startTime)),
                    endTimestamp: BigInt(getUnixTime(endTime))
                }
            );

            // Capture the initial sale data
            const saleAccountBefore = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const saleSerializer = getSaleAccountDataSerializer();
            const [saleBefore] = saleSerializer.deserialize(saleAccountBefore.data);

            // Attempt to update sale with max_tokens_per_user > max_tokens_total
            env.umi.use(signerIdentity(guardianAuthority));

            const updateSaleTx = await updateSale(env.umi, {
                authority: guardianAuthority,
                guardian: guardianAddress,
                sale: saleAddress,
                maxTokensTotal: 1000000n, // 1 million
                maxTokensPerUser: 2000000n, // 2 million - Invalid: greater than max_tokens_total
                guardPurchases: null,
                paymentAmount: null,
                startTimestamp: null,
                endTimestamp: null,
                maxPriceFeedAge: null
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(updateSaleTx));

            // Verify the sale data remains unchanged
            const saleAccountAfter = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const [saleAfter] = saleSerializer.deserialize(saleAccountAfter.data);

            // Assert that token amounts are unchanged
            expect(unwrapOption(saleAfter.maxTokensTotal)).to.equal(unwrapOption(saleBefore.maxTokensTotal));
            expect(unwrapOption(saleAfter.maxTokensPerUser)).to.equal(unwrapOption(saleBefore.maxTokensPerUser));
        });

        it("should fail to update a sale with end time before start time", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Create guardian account with update_sale permission
            const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
                env.svm,
                env.umi,
                admin,
                configAddress,
                {
                    updateConfig: false,
                    verifyPurchases: false,
                    depositTokens: false,
                    manageGuardians: false,
                    endSale: false,
                    updateSale: true,
                    withdrawFunds: false
                }
            );

            // Create valid sale account
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const { saleAddress, sale } = await createSaleAccount(
                env.svm,
                env.umi,
                {
                    admin,
                    purchaseMint: purchaseMint.mintKeypair.publicKey,
                    paymentMint: paymentMint.mintKeypair.publicKey,
                    paymentAmount: 1000000n,
                    priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                    maxPriceFeedAge: 300n,
                    guardPurchases: true,
                    maxTokensTotal: 1000000000n,
                    maxTokensPerUser: 10000000n,
                    startTimestamp: BigInt(getUnixTime(startTime)),
                    endTimestamp: BigInt(getUnixTime(endTime))
                }
            );

            // Capture the initial sale data
            const saleAccountBefore = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const saleSerializer = getSaleAccountDataSerializer();
            const [saleBefore] = saleSerializer.deserialize(saleAccountBefore.data);

            // Attempt to update sale with end time before start time
            env.umi.use(signerIdentity(guardianAuthority));

            const newStartTime = addDays(env.currentTime, 7); // Start time is 7 days in the future
            const newEndTime = addDays(env.currentTime, 1); // End time is 1 day in the future - Invalid: before start time

            const updateSaleTx = await updateSale(env.umi, {
                authority: guardianAuthority,
                guardian: guardianAddress,
                sale: saleAddress,
                startTimestamp: BigInt(getUnixTime(newStartTime)),
                endTimestamp: BigInt(getUnixTime(newEndTime)),
                guardPurchases: null,
                paymentAmount: null,
                maxTokensTotal: null,
                maxTokensPerUser: null,
                maxPriceFeedAge: null
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(updateSaleTx));

            // Verify the sale data remains unchanged
            const saleAccountAfter = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const [saleAfter] = saleSerializer.deserialize(saleAccountAfter.data);

            // Assert that timestamps are unchanged
            expect(unwrapOption(saleAfter.startTimestamp)).to.equal(unwrapOption(saleBefore.startTimestamp));
            expect(unwrapOption(saleAfter.endTimestamp)).to.equal(unwrapOption(saleBefore.endTimestamp));
        });

        it("should fail to update a sale with duration less than MIN_SALE_DURATION", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Create guardian account with update_sale permission
            const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
                env.svm,
                env.umi,
                admin,
                configAddress,
                {
                    updateConfig: false,
                    verifyPurchases: false,
                    depositTokens: false,
                    manageGuardians: false,
                    endSale: false,
                    updateSale: true,
                    withdrawFunds: false
                }
            );

            // Create valid sale account
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const { saleAddress, sale } = await createSaleAccount(
                env.svm,
                env.umi,
                {
                    admin,
                    purchaseMint: purchaseMint.mintKeypair.publicKey,
                    paymentMint: paymentMint.mintKeypair.publicKey,
                    paymentAmount: 1000000n,
                    priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                    maxPriceFeedAge: 300n,
                    guardPurchases: true,
                    maxTokensTotal: 1000000000n,
                    maxTokensPerUser: 10000000n,
                    startTimestamp: BigInt(getUnixTime(startTime)),
                    endTimestamp: BigInt(getUnixTime(endTime))
                }
            );

            // Capture the initial sale data
            const saleAccountBefore = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const saleSerializer = getSaleAccountDataSerializer();
            const [saleBefore] = saleSerializer.deserialize(saleAccountBefore.data);

            // Attempt to update sale with duration less than MIN_SALE_DURATION
            env.umi.use(signerIdentity(guardianAuthority));

            const newStartTime = addDays(env.currentTime, 1);
            const newEndTime = addSeconds(newStartTime, MIN_SALE_DURATION - 1); // Invalid: duration too short

            const updateSaleTx = await updateSale(env.umi, {
                authority: guardianAuthority,
                guardian: guardianAddress,
                sale: saleAddress,
                startTimestamp: BigInt(getUnixTime(newStartTime)),
                endTimestamp: BigInt(getUnixTime(newEndTime)),
                guardPurchases: null,
                paymentAmount: null,
                maxTokensTotal: null,
                maxTokensPerUser: null,
                maxPriceFeedAge: null
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(updateSaleTx));

            // Verify the sale data remains unchanged
            const saleAccountAfter = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const [saleAfter] = saleSerializer.deserialize(saleAccountAfter.data);

            // Assert that timestamps are unchanged
            expect(unwrapOption(saleAfter.startTimestamp)).to.equal(unwrapOption(saleBefore.startTimestamp));
            expect(unwrapOption(saleAfter.endTimestamp)).to.equal(unwrapOption(saleBefore.endTimestamp));
        });

        it("should fail to update a sale with start time too far in the future", async () => {
            // Setup test environment
            const env = createTestEnvironment();
            const mintAuthority = createUser(env.svm, env.umi);
            const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);
            const { configAddress, admin } = await createConfigAccount(env.svm, env.umi);

            // Create guardian account with update_sale permission
            const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
                env.svm,
                env.umi,
                admin,
                configAddress,
                {
                    updateConfig: false,
                    verifyPurchases: false,
                    depositTokens: false,
                    manageGuardians: false,
                    endSale: false,
                    updateSale: true,
                    withdrawFunds: false
                }
            );

            // Create valid sale account
            const startTime = addDays(env.currentTime, 1);
            const endTime = addDays(startTime, 7);

            const { saleAddress, sale } = await createSaleAccount(
                env.svm,
                env.umi,
                {
                    admin,
                    purchaseMint: purchaseMint.mintKeypair.publicKey,
                    paymentMint: paymentMint.mintKeypair.publicKey,
                    paymentAmount: 1000000n,
                    priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                    maxPriceFeedAge: 300n,
                    guardPurchases: true,
                    maxTokensTotal: 1000000000n,
                    maxTokensPerUser: 10000000n,
                    startTimestamp: BigInt(getUnixTime(startTime)),
                    endTimestamp: BigInt(getUnixTime(endTime))
                }
            );

            // Capture the initial sale data
            const saleAccountBefore = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const saleSerializer = getSaleAccountDataSerializer();
            const [saleBefore] = saleSerializer.deserialize(saleAccountBefore.data);

            // Attempt to update sale with start time too far in the future
            env.umi.use(signerIdentity(guardianAuthority));

            // Calculate a start time that's beyond MAX_FUTURE_START_TIME
            const currentTimestamp = getUnixTime(env.currentTime);
            const tooFarStartTime = new Date((currentTimestamp + MAX_FUTURE_START_TIME + 1) * 1000);
            const newEndTime = addDays(tooFarStartTime, 7);

            const updateSaleTx = await updateSale(env.umi, {
                authority: guardianAuthority,
                guardian: guardianAddress,
                sale: saleAddress,
                startTimestamp: BigInt(getUnixTime(tooFarStartTime)),
                endTimestamp: BigInt(getUnixTime(newEndTime)),
                guardPurchases: null,
                paymentAmount: null,
                maxTokensTotal: null,
                maxTokensPerUser: null,
                maxPriceFeedAge: null
            })
                .setBlockhash(env.svm.latestBlockhash())
                .buildAndSign(env.umi);

            // Send transaction (should fail)
            env.svm.sendTransaction(toWeb3JsTransaction(updateSaleTx));

            // Verify the sale data remains unchanged
            const saleAccountAfter = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const [saleAfter] = saleSerializer.deserialize(saleAccountAfter.data);

            // Assert that timestamps are unchanged
            expect(unwrapOption(saleAfter.startTimestamp)).to.equal(unwrapOption(saleBefore.startTimestamp));
            expect(unwrapOption(saleAfter.endTimestamp)).to.equal(unwrapOption(saleBefore.endTimestamp));
        });
    });
});
