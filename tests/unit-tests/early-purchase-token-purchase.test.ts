import { expect } from "chai";
import { addDays, getUnixTime } from "date-fns";
import {
    createTestEnvironment,
    createUser,
    createConfigAccount,
    createGuardianAccount,
    createSaleAccount,
    createTestMint,
    findReceiptPda,
    getTokenAccountData,
    purchaseTokensFromSale,
    endSaleAccount
} from "../helpers";
import { SPL_TOKEN_PROGRAM_ID, createAssociatedToken, findAssociatedTokenPda, mintTokensTo } from "@metaplex-foundation/mpl-toolbox";
import { transactionBuilder } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { signerIdentity, unwrapOption } from "@metaplex-foundation/umi";
import {
    getSaleAccountDataSerializer,
    getReceiptAccountDataSerializer,
    purchaseTokens as purchaseTokensInstruction,
    SaleState
} from "../../clients/js/src/generated/early_purchase";

describe("early-purchase: token purchase", () => {
    it("should purchase tokens", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress
        );

        // Create sale account
        const startTime = addDays(env.currentTime, 1);
        const endTime = addDays(startTime, 7);

        const { saleAddress, sale } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false, // Disable guard for this test
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: null, // No start time for this test
                endTimestamp: null // No end time for this test
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });

        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        })

        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyerPaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Purchase tokens
        const purchaseAmount = 5000000n;

        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta: salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        const result = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));

        // Verify receipt was created correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));

        if (receiptAccount) {
            const [receipt] = receiptSerializer.deserialize(receiptAccount.data);

            expect(receipt.buyer.toString()).to.equal(buyer.publicKey.toString());
            expect(receipt.numTokensPurchased).to.equal(purchaseAmount);
            expect(receipt.numTokensRedeemed).to.equal(0n);

            // Verify sale was updated correctly
            const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
            const saleSerializer = getSaleAccountDataSerializer();
            const [updatedSale] = saleSerializer.deserialize(saleAccount.data);

            expect(updatedSale.numTokensPurchased).to.equal(purchaseAmount);
        }
    });

    it("should fail to purchase tokens when sale is frozen", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress
        );

        // Create sale account
        const { saleAddress, sale } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: null,
                endTimestamp: null
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });
        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyerPaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Freeze the sale (set state to Frozen)
        // Note: There's no direct helper for freezing a sale, so we'll update the sale state directly
        const frozenSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const frozenSaleSerializer = getSaleAccountDataSerializer();
        const [frozenSaleData] = frozenSaleSerializer.deserialize(frozenSaleAccount.data);

        // Modify the sale state to Frozen (1)
        frozenSaleData.state = SaleState.Frozen; // 0 = Active, 1 = Frozen, 2 = Ended

        // Serialize and update the account data
        const frozenSerializedData = frozenSaleSerializer.serialize(frozenSaleData);

        // Get the current account and update its data
        const frozenCurrentAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        env.svm.setAccount(toWeb3JsPublicKey(saleAddress), {
            ...frozenCurrentAccount,
            data: frozenSerializedData
        });

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Try to purchase tokens
        const purchaseAmount = 5000000n;

        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting purchase
        const { amount: initialBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists before the transaction
        const initialReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsBefore = initialReceiptAccount !== null;

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensPurchased = initialSaleData.numTokensPurchased;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        const purchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));
        // console.log(purchaseResult.toString());

        // Verify state remains unchanged
        const { amount: finalBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists after the transaction
        const finalReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsAfter = finalReceiptAccount !== null;

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyerAmount)).to.equal(Number(initialBuyerAmount)); // No tokens transferred
        expect(receiptExistsAfter).to.equal(receiptExistsBefore); // Receipt account state unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialTokensPurchased); // Sale state unchanged
    });

    it("should fail to purchase tokens when sale is ended", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress
        );

        // Create sale account
        const { saleAddress, sale } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: null,
                endTimestamp: null
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });

        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });


        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyerPaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // End the sale (set state to Ended)
        // We can use the endSaleAccount helper for this
        await endSaleAccount(
            env.svm,
            env.umi,
            guardianAuthority,
            guardianAddress,
            saleAddress
        );

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Try to purchase tokens
        const purchaseAmount = 5000000n;

        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting purchase
        const { amount: initialBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists before the transaction
        const initialReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsBefore = initialReceiptAccount !== null;

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensPurchased = initialSaleData.numTokensPurchased;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        const purchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));
        // console.log(purchaseResult.toString())

        // Verify state remains unchanged
        const { amount: finalBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists after the transaction
        const finalReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsAfter = finalReceiptAccount !== null;

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyerAmount)).to.equal(Number(initialBuyerAmount)); // No tokens transferred
        expect(receiptExistsAfter).to.equal(receiptExistsBefore); // Receipt account state unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialTokensPurchased); // Sale state unchanged
    });

    it("should fail to purchase tokens before start time", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress
        );

        // Set start time to 2 days in the future
        const startTime = addDays(env.currentTime, 2);
        const endTime = addDays(startTime, 7);

        // Create sale account with future start time
        const { saleAddress, sale } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(startTime)), // Set future start time
                endTimestamp: BigInt(getUnixTime(endTime))
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });

        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyerPaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Try to purchase tokens before start time
        const purchaseAmount = 5000000n;

        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting purchase
        const { amount: initialBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists before the transaction
        const initialReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsBefore = initialReceiptAccount !== null;

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensPurchased = initialSaleData.numTokensPurchased;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        const purchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));
        // console.log(purchaseResult.toString())

        // Verify state remains unchanged
        const { amount: finalBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists after the transaction
        const finalReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsAfter = finalReceiptAccount !== null;

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyerAmount)).to.equal(Number(initialBuyerAmount)); // No tokens transferred
        expect(receiptExistsAfter).to.equal(receiptExistsBefore); // Receipt account state unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialTokensPurchased); // Sale state unchanged
    });

    it("should fail to purchase tokens after end time", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress
        );

        // Set end time to 2 days in the past
        const endTime = addDays(env.currentTime, -2);
        const startTime = addDays(endTime, -7); // Start time is 7 days before end time (9 days ago)

        // Create sale account with past end time
        const { saleAddress, sale } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: BigInt(getUnixTime(startTime)),
                endTimestamp: BigInt(getUnixTime(endTime)) // Set past end time
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });
        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyerPaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Try to purchase tokens after end time
        const purchaseAmount = 5000000n;

        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting purchase
        const { amount: initialBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists before the transaction
        const initialReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsBefore = initialReceiptAccount !== null;

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensPurchased = initialSaleData.numTokensPurchased;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        const purchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));
        // console.log(purchaseResult.toString());

        // Verify state remains unchanged
        const { amount: finalBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists after the transaction
        const finalReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsAfter = finalReceiptAccount !== null;

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyerAmount)).to.equal(Number(initialBuyerAmount)); // No tokens transferred
        expect(receiptExistsAfter).to.equal(receiptExistsBefore); // Receipt account state unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialTokensPurchased); // Sale state unchanged
    });

    it("should fail to purchase tokens when exceeding max tokens per user", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress
        );

        // Create sale account with a low max tokens per user limit
        const maxTokensPerUser = 1000000n; // Set a low limit
        const { saleAddress, sale } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: maxTokensPerUser, // Set low max tokens per user
                startTimestamp: null,
                endTimestamp: null
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });

        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyerPaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // First purchase (within limit)
        const initialPurchaseAmount = maxTokensPerUser / 2n;

        env.umi.use(signerIdentity(buyer));
        const initialPurchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: initialPurchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // This purchase should succeed
        const initialPurchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(initialPurchaseTx));
        // console.log(initialPurchaseResult.toString());

        // Verify receipt was created correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [receipt] = receiptSerializer.deserialize(receiptAccount.data);

        expect(receipt.numTokensPurchased).to.equal(initialPurchaseAmount);

        // Try to purchase more tokens that would exceed the max tokens per user
        const secondPurchaseAmount = maxTokensPerUser; // This would exceed the limit

        env.umi.use(signerIdentity(buyer));
        const secondPurchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: secondPurchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting second purchase
        const { amount: initialBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Get initial receipt account data
        const initialReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const initialReceiptSerializer = getReceiptAccountDataSerializer();
        const [initialReceipt] = initialReceiptSerializer.deserialize(initialReceiptAccount.data);

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        const secondPurchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(secondPurchaseTx));
        // console.log(secondPurchaseResult.toString());

        // Verify state remains unchanged
        const { amount: finalBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Get updated receipt account data
        const updatedReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const updatedReceiptSerializer = getReceiptAccountDataSerializer();
        const [updatedReceipt] = updatedReceiptSerializer.deserialize(updatedReceiptAccount.data);

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyerAmount)).to.equal(Number(initialBuyerAmount)); // No tokens transferred
        expect(updatedReceipt.numTokensPurchased).to.equal(initialReceipt.numTokensPurchased); // Receipt unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialSaleData.numTokensPurchased); // Sale state unchanged
    });

    it("should fail to purchase tokens when exceeding max tokens total", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress
        );

        // Create sale account with a low max tokens total limit
        const maxTokensTotal = 1000000n; // Set a low limit
        const { saleAddress, sale, result: saleResult } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false,
                maxTokensTotal: maxTokensTotal, // Set low max tokens total
                maxTokensPerUser: maxTokensTotal - 100n,
                startTimestamp: null,
                endTimestamp: null
            }
        );

        // console.log(saleResult.toString());

        // Create first buyer
        const buyer1 = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyer1PaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer1.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });
        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        const mintTx1 = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer1.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyer1PaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx1));

        // Find receipt PDA for first buyer
        const [receipt1Address] = findReceiptPda(env.umi, buyer1.publicKey, saleAddress);

        // First purchase (half of the max)
        const initialPurchaseAmount = maxTokensTotal / 2n;

        env.umi.use(signerIdentity(buyer1));
        const initialPurchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer1,
            buyerPaymentAta: buyer1PaymentTokenAddress,
            salePaymentAta,
            receipt: receipt1Address,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: initialPurchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // This purchase should succeed
        const initialPurchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(initialPurchaseTx));
        // console.log(initialPurchaseResult.toString());

        // Verify receipt was created correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receipt1Account = env.svm.getAccount(toWeb3JsPublicKey(receipt1Address));
        const [receipt1] = receiptSerializer.deserialize(receipt1Account.data);

        expect(receipt1.numTokensPurchased).to.equal(initialPurchaseAmount);

        // Create second buyer
        const buyer2 = createUser(env.svm, env.umi);

        // Create and fund second buyer's payment token account
        const [buyer2PaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer2.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });

        const mintTx2 = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer2.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyer2PaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx2));

        // Find receipt PDA for second buyer
        const [receipt2Address] = findReceiptPda(env.umi, buyer2.publicKey, saleAddress);

        // Try to purchase more tokens that would exceed the max tokens total
        const secondPurchaseAmount = maxTokensTotal; // This would exceed the limit

        env.umi.use(signerIdentity(buyer2));
        const secondPurchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer2,
            buyerPaymentAta: buyer2PaymentTokenAddress,
            salePaymentAta,
            receipt: receipt2Address,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: secondPurchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting second purchase
        const { amount: initialBuyer2Amount } = getTokenAccountData(env.svm, buyer2PaymentTokenAddress);

        // Check if receipt2 account exists before the transaction
        const initialReceipt2Account = env.svm.getAccount(toWeb3JsPublicKey(receipt2Address));
        const receipt2ExistsBefore = initialReceipt2Account !== null;

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        const secondPurchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(secondPurchaseTx));
        // console.log(secondPurchaseResult.toString());

        // Verify state remains unchanged
        const { amount: finalBuyer2Amount } = getTokenAccountData(env.svm, buyer2PaymentTokenAddress);

        // Check if receipt2 account exists after the transaction
        const finalReceipt2Account = env.svm.getAccount(toWeb3JsPublicKey(receipt2Address));
        const receipt2ExistsAfter = finalReceipt2Account !== null;

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyer2Amount)).to.equal(Number(initialBuyer2Amount)); // No tokens transferred
        expect(receipt2ExistsAfter).to.equal(receipt2ExistsBefore); // Receipt2 account state unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialSaleData.numTokensPurchased); // Sale state unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialPurchaseAmount); // Still equals first purchase amount
    });

    it("should fail to purchase tokens without verification when required", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account with verify_purchases permission
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress,
            {
                updateConfig: false,
                verifyPurchases: true, // Enable verify purchases permission
                depositTokens: false,
                manageGuardians: false,
                endSale: false,
                updateSale: false,
                withdrawFunds: false
            }
        );

        // Create sale account with guardPurchases set to true
        const { saleAddress, sale } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: true, // Require guardian verification
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: null,
                endTimestamp: null
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });

        const [salePaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: buyer.publicKey,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: buyerPaymentTokenAddress,
                    amount: 10000000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Try to purchase tokens without providing a guardian
        const purchaseAmount = 5000000n;

        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
            // Note: We're not providing authority or guardian here
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting purchase
        const { amount: initialBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists before the transaction
        const initialReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsBefore = initialReceiptAccount !== null;

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensPurchased = initialSaleData.numTokensPurchased;

        const purchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));
        // console.log(purchaseResult.toString());

        // Verify state remains unchanged
        const { amount: finalBuyerAmount } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists after the transaction
        const finalReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsAfter = finalReceiptAccount !== null;

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyerAmount)).to.equal(Number(initialBuyerAmount)); // No tokens transferred
        expect(receiptExistsAfter).to.equal(receiptExistsBefore); // Receipt account state unchanged
        expect(updatedSaleData.numTokensPurchased).to.equal(initialTokensPurchased); // Sale state unchanged

        // Now try with a guardian that doesn't have verify_purchases permission
        const nonVerifyingGuardian = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress,
            {
                updateConfig: true,
                verifyPurchases: false, // No verify purchases permission
                depositTokens: true,
                manageGuardians: true,
                endSale: true,
                updateSale: true,
                withdrawFunds: true
            }
        );

        // Try to purchase tokens with a guardian that doesn't have verify_purchases permission
        env.umi.use(signerIdentity(buyer));
        const purchaseTx2 = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            authority: nonVerifyingGuardian.guardianAuthority,
            guardian: nonVerifyingGuardian.guardianAddress,
            buyerPaymentAta: buyerPaymentTokenAddress,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting purchase with non-verifying guardian
        const { amount: initialBuyerAmount2 } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists before the transaction
        const initialReceiptAccount2 = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsBefore2 = initialReceiptAccount2 !== null;

        // Get initial sale account data
        const initialSaleAccount2 = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer2 = getSaleAccountDataSerializer();
        const [initialSaleData2] = initialSaleSerializer2.deserialize(initialSaleAccount2.data);
        const initialTokensPurchased2 = initialSaleData2.numTokensPurchased;

        const secondPurchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx2));
        // console.log(secondPurchaseResult.toString());

        // Verify state remains unchanged
        const { amount: finalBuyerAmount2 } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Check if receipt account exists after the transaction
        const finalReceiptAccount2 = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const receiptExistsAfter2 = finalReceiptAccount2 !== null;

        // Get updated sale account data
        const updatedSaleAccount2 = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer2 = getSaleAccountDataSerializer();
        const [updatedSaleData2] = updatedSaleSerializer2.deserialize(updatedSaleAccount2.data);

        // Verify all state remains unchanged
        expect(Number(finalBuyerAmount2)).to.equal(Number(initialBuyerAmount2)); // No tokens transferred
        expect(receiptExistsAfter2).to.equal(receiptExistsBefore2); // Receipt account state unchanged
        expect(updatedSaleData2.numTokensPurchased).to.equal(initialTokensPurchased2); // Sale state unchanged

        // Finally, try with a valid guardian that has verify_purchases permission
        // This should succeed
        const purchaseAmount3 = 1000n;

        // Capture initial state before attempting purchase with valid guardian
        const { amount: initialBuyerAmount3 } = getTokenAccountData(env.svm, buyerPaymentTokenAddress);

        // Get initial sale account data
        const initialSaleAccount3 = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer3 = getSaleAccountDataSerializer();
        const [initialSaleData3] = initialSaleSerializer3.deserialize(initialSaleAccount3.data);
        const initialTokensPurchased3 = initialSaleData3.numTokensPurchased;

        // Create a purchase transaction with the valid guardian
        env.umi.use(signerIdentity(buyer));
        const purchaseTx3 = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            authority: guardianAuthority, // Use the guardian with verify_purchases permission
            guardian: guardianAddress,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount3,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // This purchase should succeed
        const thirdPurchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx3));
        // console.log(thirdPurchaseResult.toString());

        // Verify receipt was updated correctly
        const finalReceiptAccount3 = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const finalReceiptSerializer3 = getReceiptAccountDataSerializer();
        const [finalReceipt3] = finalReceiptSerializer3.deserialize(finalReceiptAccount3.data);

        // Get updated sale account data
        const updatedSaleAccount3 = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer3 = getSaleAccountDataSerializer();
        const [updatedSaleData3] = updatedSaleSerializer3.deserialize(updatedSaleAccount3.data);

        // Verify state was updated correctly
        expect(finalReceipt3.numTokensPurchased).to.equal(initialTokensPurchased2 + purchaseAmount3); // Receipt updated
        expect(updatedSaleData3.numTokensPurchased).to.equal(initialTokensPurchased3 + purchaseAmount3); // Sale updated
    });
});
