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
    endSaleAccount,
    purchaseTokensFromSale,
    depositTokensToSale
} from "../helpers";
import { SPL_TOKEN_PROGRAM_ID, createAssociatedToken, findAssociatedTokenPda, mintTokensTo } from "@metaplex-foundation/mpl-toolbox";
import { transactionBuilder } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { signerIdentity, unwrapOption } from "@metaplex-foundation/umi";
import {
    getSaleAccountDataSerializer,
    getReceiptAccountDataSerializer,
    purchaseTokens as purchaseTokensInstruction
} from "../../clients/js/src/generated/early_purchase";

describe("early-purchase: token deposit", () => {
    it("should deposit tokens", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account with deposit permissions
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress,
            {
                updateConfig: true,
                verifyPurchases: true,
                depositTokens: true,
                manageGuardians: true,
                endSale: true,
                updateSale: true,
                withdrawFunds: true
            }
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
                maxTokensTotal: 1_000_000_000n,
                maxTokensPerUser: 10_000_000n,
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

        // Create sale payment token account
        const [salePaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        // Create token accounts and mint tokens to buyer
        const setupTx = await transactionBuilder()
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
                    amount: 10_000_000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        const setupResult = env.svm.sendTransaction(toWeb3JsTransaction(setupTx));

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        const purchaseAmount = 10n;

        // Purchase tokens
        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta: salePaymentTokenAddress,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        const purchaseResult = env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));
        // console.log(purchaseResult.toString())

        // Verify receipt was created correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [receipt] = receiptSerializer.deserialize(receiptAccount.data);

        expect(receipt.buyer.toString()).to.equal(buyer.publicKey.toString());
        expect(receipt.numTokensPurchased).to.equal(purchaseAmount);
        expect(receipt.numTokensRedeemed).to.equal(0n);

        // Verify sale was updated correctly
        const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const saleSerializer = getSaleAccountDataSerializer();
        const [saleData] = saleSerializer.deserialize(saleAccount.data);
        expect(saleData.numTokensPurchased).to.equal(purchaseAmount);

        // End the sale (required for deposits)
        await endSaleAccount(
            env.svm,
            env.umi,
            guardianAuthority,
            guardianAddress,
            saleAddress
        );

        // Create depositor (guardian authority)
        const depositor = guardianAuthority;

        // Create and fund depositor's purchase token account
        const [depositorPurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: depositor.publicKey,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Create sale purchase token account
        const [salePurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Setup token accounts for deposit
        const depositSetupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: depositor.publicKey,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: depositorPurchaseTokenAddress,
                    amount: 10000000,
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(depositSetupTx));

        // Deposit tokens
        const depositAmount = 10n;
        const { sale: updatedSale } = await depositTokensToSale(
            env.svm,
            env.umi,
            {
                authority: depositor,
                guardian: guardianAddress,
                sale: saleAddress,
                salePurchaseAta: salePurchaseTokenAddress,
                authorityPurchaseAta: depositorPurchaseTokenAddress,
                purchaseProgram: SPL_TOKEN_PROGRAM_ID,
                amountToDeposit: depositAmount
            }
        );

        // Verify sale was updated correctly
        expect(updatedSale.numTokensDeposited).to.equal(depositAmount);

        // Verify tokens were transferred
        const { amount: depositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: saleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        expect(Number(depositorAmount)).to.equal(10000000 - Number(depositAmount));
        expect(Number(saleAmount)).to.equal(Number(depositAmount));
    });

    it("should deposit exact amount of tokens specified by caller", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account with deposit permissions
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress,
            {
                updateConfig: true,
                verifyPurchases: true,
                depositTokens: true,
                manageGuardians: true,
                endSale: true,
                updateSale: true,
                withdrawFunds: true
            }
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
                maxTokensTotal: 1_000_000_000n,
                maxTokensPerUser: 10_000_000n,
                startTimestamp: null,
                endTimestamp: null
            }
        );

        // Create buyer and perform a purchase to set up the sale
        const buyer = createUser(env.svm, env.umi);
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });
        const [salePaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        // Create token accounts and mint tokens to buyer
        const setupTx = await transactionBuilder()
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
                    amount: 10_000_000,
                    mint: paymentMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(setupTx));

        // Purchase tokens
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);
        const purchaseAmount = 100n;

        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta: salePaymentTokenAddress,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));

        // End the sale (required for deposits)
        await endSaleAccount(
            env.svm,
            env.umi,
            guardianAuthority,
            guardianAddress,
            saleAddress
        );

        // Create depositor (guardian authority)
        const depositor = guardianAuthority;

        // Create and fund depositor's purchase token account
        const [depositorPurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: depositor.publicKey,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Create sale purchase token account
        const [salePurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Setup token accounts for deposit
        const depositSetupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: depositor.publicKey,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: depositorPurchaseTokenAddress,
                    amount: 10000000,
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(depositSetupTx));

        // Get initial token balances before deposit
        const { amount: initialDepositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: initialSaleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Deposit a specific amount of tokens
        // Note: The deposit amount must be less than or equal to the number of tokens purchased
        // This is enforced by the has_deposit_supply check in the Sale struct
        const depositAmount = 50n; // Less than the 100 tokens purchased
        const { sale: updatedSale } = await depositTokensToSale(
            env.svm,
            env.umi,
            {
                authority: depositor,
                guardian: guardianAddress,
                sale: saleAddress,
                salePurchaseAta: salePurchaseTokenAddress,
                authorityPurchaseAta: depositorPurchaseTokenAddress,
                purchaseProgram: SPL_TOKEN_PROGRAM_ID,
                amountToDeposit: depositAmount
            }
        );

        // Get final token balances after deposit
        const { amount: finalDepositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: finalSaleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Verify the caller's token account was decremented by exactly the specified amount
        expect(initialDepositorAmount - finalDepositorAmount).to.equal(depositAmount);

        // Verify the sale's token account was incremented by exactly the specified amount
        expect(finalSaleAmount - initialSaleAmount).to.equal(depositAmount);


        // Verify sale state was updated correctly
        expect(updatedSale.numTokensDeposited).to.equal(depositAmount);
    });

    it("should fail to deposit tokens without guardian permission", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account WITHOUT deposit permissions
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress,
            {
                updateConfig: true,
                verifyPurchases: true,
                depositTokens: false, // No deposit permission
                manageGuardians: true,
                endSale: true,
                updateSale: true,
                withdrawFunds: true
            }
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

        // Create sale payment token account
        const [salePaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        // Create token accounts and mint tokens to buyer
        const setupTx = await transactionBuilder()
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

        env.svm.sendTransaction(toWeb3JsTransaction(setupTx));

        // Perform the purchase step
        const purchaseAmount = 5000000n;

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Purchase tokens
        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta: salePaymentTokenAddress,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));

        // Verify receipt was created correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [receipt] = receiptSerializer.deserialize(receiptAccount.data);

        expect(receipt.buyer.toString()).to.equal(buyer.publicKey.toString());
        expect(receipt.numTokensPurchased).to.equal(purchaseAmount);
        expect(receipt.numTokensRedeemed).to.equal(0n);

        // Verify sale was updated correctly
        const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const saleSerializer = getSaleAccountDataSerializer();
        const [saleData] = saleSerializer.deserialize(saleAccount.data);
        expect(saleData.numTokensPurchased).to.equal(purchaseAmount);

        // End the sale (required for deposits)
        await endSaleAccount(
            env.svm,
            env.umi,
            guardianAuthority,
            guardianAddress,
            saleAddress
        );

        // Create depositor (guardian authority)
        const depositor = guardianAuthority;

        // Create and fund depositor's purchase token account
        const [depositorPurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: depositor.publicKey,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Create sale purchase token account
        const [salePurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Setup token accounts for deposit
        const depositSetupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: depositor.publicKey,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: depositorPurchaseTokenAddress,
                    amount: 10000000,
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(depositSetupTx));

        // Capture initial state before attempting deposit
        const { amount: initialDepositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: initialSaleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensDeposited = initialSaleData.numTokensDeposited;

        // Try to deposit tokens with guardian that doesn't have deposit permission
        const depositAmount = 5000000n;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        await depositTokensToSale(
            env.svm,
            env.umi,
            {
                authority: depositor,
                guardian: guardianAddress,
                sale: saleAddress,
                salePurchaseAta: salePurchaseTokenAddress,
                authorityPurchaseAta: depositorPurchaseTokenAddress,
                purchaseProgram: SPL_TOKEN_PROGRAM_ID,
                amountToDeposit: depositAmount
            }
        );

        // Verify tokens were not transferred (state remains unchanged)
        const { amount: depositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: saleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(depositorAmount)).to.equal(Number(initialDepositorAmount)); // No tokens transferred
        expect(Number(saleAmount)).to.equal(Number(initialSaleAmount)); // No tokens received
        expect(updatedSaleData.numTokensDeposited).to.equal(initialTokensDeposited); // Sale state unchanged
    });

    it("should fail to deposit tokens when sale is not ended", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account with deposit permissions
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress,
            {
                updateConfig: true,
                verifyPurchases: true,
                depositTokens: true, // Has deposit permission
                manageGuardians: true,
                endSale: true,
                updateSale: true,
                withdrawFunds: true
            }
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

        // Create sale payment token account
        const [salePaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        // Create token accounts and mint tokens to buyer
        const setupTx = await transactionBuilder()
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

        env.svm.sendTransaction(toWeb3JsTransaction(setupTx));

        // Perform the purchase step
        const purchaseAmount = 5000000n;

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Purchase tokens
        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta: salePaymentTokenAddress,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));

        // Verify receipt was created correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [receipt] = receiptSerializer.deserialize(receiptAccount.data);

        expect(receipt.buyer.toString()).to.equal(buyer.publicKey.toString());
        expect(receipt.numTokensPurchased).to.equal(purchaseAmount);
        expect(receipt.numTokensRedeemed).to.equal(0n);

        // Verify sale was updated correctly
        const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const saleSerializer = getSaleAccountDataSerializer();
        const [saleData] = saleSerializer.deserialize(saleAccount.data);
        expect(saleData.numTokensPurchased).to.equal(purchaseAmount);

        // Note: We do NOT end the sale here, which should cause the deposit to fail

        // Create depositor (guardian authority)
        const depositor = guardianAuthority;

        // Create and fund depositor's purchase token account
        const [depositorPurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: depositor.publicKey,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Create sale purchase token account
        const [salePurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Setup token accounts for deposit
        const depositSetupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: depositor.publicKey,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: depositorPurchaseTokenAddress,
                    amount: 10000000,
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(depositSetupTx));

        // Capture initial state before attempting deposit
        const { amount: initialDepositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: initialSaleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensDeposited = initialSaleData.numTokensDeposited;

        // Try to deposit tokens when sale is not ended
        const depositAmount = 5000000n;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        await depositTokensToSale(
            env.svm,
            env.umi,
            {
                authority: depositor,
                guardian: guardianAddress,
                sale: saleAddress,
                salePurchaseAta: salePurchaseTokenAddress,
                authorityPurchaseAta: depositorPurchaseTokenAddress,
                purchaseProgram: SPL_TOKEN_PROGRAM_ID,
                amountToDeposit: depositAmount
            }
        );

        // Verify tokens were not transferred (state remains unchanged)
        const { amount: depositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: saleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(depositorAmount)).to.equal(Number(initialDepositorAmount)); // No tokens transferred
        expect(Number(saleAmount)).to.equal(Number(initialSaleAmount)); // No tokens received
        expect(updatedSaleData.numTokensDeposited).to.equal(initialTokensDeposited); // Sale state unchanged
    });

    it("should fail to deposit tokens when sale is frozen", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create purchase and payment mints
        const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create config account
        const { configAddress, config, admin } = await createConfigAccount(env.svm, env.umi);

        // Create guardian account with deposit permissions
        const { guardianAddress, guardian, guardianAuthority } = await createGuardianAccount(
            env.svm,
            env.umi,
            admin,
            configAddress,
            {
                updateConfig: true,
                verifyPurchases: true,
                depositTokens: true, // Has deposit permission
                manageGuardians: true,
                endSale: true,
                updateSale: true,
                withdrawFunds: true
            }
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

        // Create sale payment token account
        const [salePaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        // Create token accounts and mint tokens to buyer
        const setupTx = await transactionBuilder()
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

        env.svm.sendTransaction(toWeb3JsTransaction(setupTx));

        // Perform the purchase step
        const purchaseAmount = 5000000n;

        // Find receipt PDA
        const [receiptAddress] = findReceiptPda(env.umi, buyer.publicKey, saleAddress);

        // Purchase tokens
        env.umi.use(signerIdentity(buyer));
        const purchaseTx = await purchaseTokensInstruction(env.umi, {
            sale: saleAddress,
            buyer: buyer,
            buyerPaymentAta: buyerPaymentTokenAddress,
            salePaymentAta: salePaymentTokenAddress,
            receipt: receiptAddress,
            paymentProgram: SPL_TOKEN_PROGRAM_ID,
            amountToPurchase: purchaseAmount,
            maxLamportsToSpend: 0
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(purchaseTx));

        // Verify receipt was created correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [receipt] = receiptSerializer.deserialize(receiptAccount.data);

        expect(receipt.buyer.toString()).to.equal(buyer.publicKey.toString());
        expect(receipt.numTokensPurchased).to.equal(purchaseAmount);
        expect(receipt.numTokensRedeemed).to.equal(0n);

        // Verify sale was updated correctly
        const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const saleSerializer = getSaleAccountDataSerializer();
        const [saleData] = saleSerializer.deserialize(saleAccount.data);
        expect(saleData.numTokensPurchased).to.equal(purchaseAmount);

        // Freeze the sale (set state to Frozen)
        // Note: There's no direct helper for freezing a sale, so we'll update the sale state directly
        // This is a bit of a hack, but it's the only way to test this scenario
        const frozenSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const frozenSaleSerializer = getSaleAccountDataSerializer();
        const [frozenSaleData] = frozenSaleSerializer.deserialize(frozenSaleAccount.data);

        // Modify the sale state to Frozen (1)
        frozenSaleData.state = 1; // 0 = Active, 1 = Frozen, 2 = Ended

        // Serialize and update the account data
        const frozenSerializedData = frozenSaleSerializer.serialize(frozenSaleData);

        // Get the current account and update its data
        const frozenCurrentAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        env.svm.setAccount(toWeb3JsPublicKey(saleAddress), {
            ...frozenCurrentAccount,
            data: frozenSerializedData
        });

        // Create depositor (guardian authority)
        const depositor = guardianAuthority;

        // Create and fund depositor's purchase token account
        const [depositorPurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: depositor.publicKey,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Create sale purchase token account
        const [salePurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Setup token accounts for deposit
        const depositSetupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: depositor.publicKey,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: depositorPurchaseTokenAddress,
                    amount: 10000000,
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(depositSetupTx));

        // Capture initial state before attempting deposit
        const { amount: initialDepositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: initialSaleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Get initial sale account data
        const initialSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const initialSaleSerializer = getSaleAccountDataSerializer();
        const [initialSaleData] = initialSaleSerializer.deserialize(initialSaleAccount.data);
        const initialTokensDeposited = initialSaleData.numTokensDeposited;

        // Try to deposit tokens when sale is frozen
        const depositAmount = 5000000n;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        await depositTokensToSale(
            env.svm,
            env.umi,
            {
                authority: depositor,
                guardian: guardianAddress,
                sale: saleAddress,
                salePurchaseAta: salePurchaseTokenAddress,
                authorityPurchaseAta: depositorPurchaseTokenAddress,
                purchaseProgram: SPL_TOKEN_PROGRAM_ID,
                amountToDeposit: depositAmount
            }
        );

        // Verify tokens were not transferred (state remains unchanged)
        const { amount: depositorAmount } = getTokenAccountData(env.svm, depositorPurchaseTokenAddress);
        const { amount: saleAmount } = getTokenAccountData(env.svm, salePurchaseTokenAddress);

        // Get updated sale account data
        const updatedSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const updatedSaleSerializer = getSaleAccountDataSerializer();
        const [updatedSaleData] = updatedSaleSerializer.deserialize(updatedSaleAccount.data);

        // Verify all state remains unchanged
        expect(Number(depositorAmount)).to.equal(Number(initialDepositorAmount)); // No tokens transferred
        expect(Number(saleAmount)).to.equal(Number(initialSaleAmount)); // No tokens received
        expect(updatedSaleData.numTokensDeposited).to.equal(initialTokensDeposited); // Sale state unchanged
    });

    it.skip("should calculate token count based on paymentAmount", () => {
        // right now the tests just do a 1:1 payment amount.
    });
});
