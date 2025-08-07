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
    purchaseTokensFromSale
} from "../helpers";
import { SPL_TOKEN_PROGRAM_ID, createAssociatedToken, findAssociatedTokenPda, mintTokensTo } from "@metaplex-foundation/mpl-toolbox";
import { transactionBuilder } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import {
    EarlyPurchase
} from "../../clients/js";
import {
    EARLY_PURCHASE_PROGRAM_ID,
    getReceiptAccountDataSerializer,
    getSaleAccountDataSerializer,
    purchaseTokens as purchaseTokensInstruction
} from "../../clients/js/src/generated/early_purchase";
import { signerIdentity } from "@metaplex-foundation/umi";

describe("early-purchase: token redemption", () => {
    it("should redeem tokens", async () => {
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
        const { saleAddress, sale, result: createSaleResult } = await createSaleAccount(
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

        // Create buyer's purchase token account
        const [buyerPurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Create sale payment ATA
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
                    owner: buyer.publicKey,
                    mint: purchaseMint.mintKeypair.publicKey
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

        const mintResult = env.svm.sendTransaction(toWeb3JsTransaction(mintTx));
        // console.log(mintResult.toString())

        // Purchase tokens
        const purchaseAmount = 5000000n;

        const { receiptAddress, receipt, result: purchaseResult } = await purchaseTokensFromSale(
            env.svm,
            env.umi,
            {
                buyer: buyer,
                sale: saleAddress,
                buyerPaymentAta: buyerPaymentTokenAddress,
                salePaymentAta: salePaymentAta,
                paymentProgram: SPL_TOKEN_PROGRAM_ID,
                amountToPurchase: purchaseAmount
            }
        );

        // console.log(purchaseResult.toString())

        // Create sale token account
        const [saleTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Mint tokens to sale account (simulating deposit)
        const depositTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: saleTokenAddress,
                    amount: Number(purchaseAmount),
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        const depositResult = env.svm.sendTransaction(toWeb3JsTransaction(depositTx));

        // Verify receipt was created correctly by the purchase transaction
        const initialReceiptSerializer = getReceiptAccountDataSerializer();
        const initialReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [initialReceipt] = initialReceiptSerializer.deserialize(initialReceiptAccount.data);

        expect(initialReceipt.buyer.toString()).to.equal(buyer.publicKey.toString());
        expect(initialReceipt.sale.toString()).to.equal(saleAddress.toString());
        expect(initialReceipt.numTokensPurchased).to.equal(purchaseAmount);
        expect(initialReceipt.numTokensRedeemed).to.equal(0n);

        // Update the sale to reflect the deposit
        const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const saleSerializer = getSaleAccountDataSerializer();
        const [updatedSale] = saleSerializer.deserialize(saleAccount.data);
        updatedSale.numTokensDeposited = purchaseAmount;

        // Update the sale account with the new data
        env.svm.setAccount(toWeb3JsPublicKey(saleAddress), {
            ...saleAccount,
            data: saleSerializer.serialize(updatedSale)
        });

        // Redeem tokens
        const redeemTx = await EarlyPurchase.redeemReceipt(env.umi, {
            sale: saleAddress,
            receipt: receiptAddress,
            buyer: buyer,
            buyerPurchaseAta: buyerPurchaseTokenAddress,
            configPurchaseAta: saleTokenAddress,
            purchaseProgram: SPL_TOKEN_PROGRAM_ID
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        const redeemResult = env.svm.sendTransaction(toWeb3JsTransaction(redeemTx));
        // console.log(redeemResult.toString())

        // Verify receipt was updated correctly
        const finalReceiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [finalReceipt] = initialReceiptSerializer.deserialize(finalReceiptAccount.data);

        expect(finalReceipt.numTokensRedeemed).to.equal(purchaseAmount);

        // Verify sale was updated correctly
        const finalSaleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
        const [finalSale] = saleSerializer.deserialize(finalSaleAccount.data);
        expect(finalSale.numTokensDistributed).to.equal(purchaseAmount);

        // Verify buyer received tokens
        const buyerPurchaseTokenAccount = env.svm.getAccount(toWeb3JsPublicKey(buyerPurchaseTokenAddress));
        const { amount } = getTokenAccountData(env.svm, buyerPurchaseTokenAddress);
        expect(Number(amount)).to.equal(Number(purchaseAmount));
    });

    it.skip("should fail to redeem tokens when sale has no tokens", async () => {
        // TODO: Test redeeming tokens when sale has no tokens
    });

    it.skip("should fail to redeem tokens when receipt is already redeemed", async () => {
        // TODO: Test redeeming tokens when receipt is already redeemed
    });

    it("should fail to redeem receipt from one sale against another sale", async () => {
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

        // Create first sale account (Sale A)
        const { saleAddress: saleAAddress, sale: saleA } = await createSaleAccount(
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
                endTimestamp: null,
                id: 1 // Use ID 1 for Sale A
            }
        );

        // Create second sale account (Sale B) with the same token types but different ID
        const { saleAddress: saleBAddress, sale: saleB } = await createSaleAccount(
            env.svm,
            env.umi,
            {
                admin,
                purchaseMint: purchaseMint.mintKeypair.publicKey,
                paymentMint: paymentMint.mintKeypair.publicKey,
                paymentAmount: 1000000n,
                priceFeedIdHex: "0000000000000000000000000000000000000000000000000000000000000000",
                maxPriceFeedAge: 300n,
                guardPurchases: false,
                maxTokensTotal: 1000000000n,
                maxTokensPerUser: 10000000n,
                startTimestamp: null,
                endTimestamp: null,
                id: 2 // Use ID 2 for Sale B
            }
        );

        // Create buyer
        const buyer = createUser(env.svm, env.umi);

        // Create and fund buyer's payment token account
        const [buyerPaymentTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: paymentMint.mintKeypair.publicKey
        });

        // Create buyer's purchase token account
        const [buyerPurchaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: buyer.publicKey,
            mint: purchaseMint.mintKeypair.publicKey
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
                    owner: buyer.publicKey,
                    mint: purchaseMint.mintKeypair.publicKey
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

        // Create sale payment ATA for Sale A
        const [saleAPaymentAta] = findAssociatedTokenPda(env.umi, {
            owner: saleAAddress,
            mint: paymentMint.mintKeypair.publicKey
        });

        // Create the sale payment ATA
        const createSalePaymentAtaTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAAddress,
                    mint: paymentMint.mintKeypair.publicKey
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(createSalePaymentAtaTx));

        // Purchase tokens from Sale A
        const purchaseAmount = 5000000n;

        const { receiptAddress, receipt: saleAReceipt } = await purchaseTokensFromSale(
            env.svm,
            env.umi,
            {
                buyer: buyer,
                sale: saleAAddress,
                buyerPaymentAta: buyerPaymentTokenAddress,
                salePaymentAta: saleAPaymentAta,
                paymentProgram: SPL_TOKEN_PROGRAM_ID,
                amountToPurchase: purchaseAmount
            }
        );

        // Create token accounts for both sales
        const [saleATokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleAAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        const [saleBTokenAddress] = findAssociatedTokenPda(env.umi, {
            owner: saleBAddress,
            mint: purchaseMint.mintKeypair.publicKey
        });

        // Mint tokens to both sale accounts (simulating deposits)
        const depositTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleAAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                createAssociatedToken(env.umi, {
                    owner: saleBAddress,
                    mint: purchaseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: saleATokenAddress,
                    amount: Number(purchaseAmount),
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: saleBTokenAddress,
                    amount: Number(purchaseAmount),
                    mint: purchaseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(depositTx));

        // Update both sales to reflect deposits
        const saleAAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAAddress));
        const saleBAccount = env.svm.getAccount(toWeb3JsPublicKey(saleBAddress));
        const saleSerializer = getSaleAccountDataSerializer();

        const [updatedSaleA] = saleSerializer.deserialize(saleAAccount.data);
        updatedSaleA.numTokensDeposited = purchaseAmount;

        const [updatedSaleB] = saleSerializer.deserialize(saleBAccount.data);
        updatedSaleB.numTokensDeposited = purchaseAmount;

        // Update the accounts with the new data
        env.svm.setAccount(toWeb3JsPublicKey(saleAAddress), {
            ...saleAAccount,
            data: saleSerializer.serialize(updatedSaleA)
        });

        env.svm.setAccount(toWeb3JsPublicKey(saleBAddress), {
            ...saleBAccount,
            data: saleSerializer.serialize(updatedSaleB)
        });

        // Attempt to redeem the receipt against Sale B (should fail)
        env.umi.use(signerIdentity(buyer));
        const invalidRedeemTx = await EarlyPurchase.redeemReceipt(env.umi, {
            sale: saleBAddress, // Try to redeem against Sale B
            receipt: receiptAddress, // Receipt from Sale A
            buyer: buyer,
            buyerPurchaseAta: buyerPurchaseTokenAddress,
            configPurchaseAta: saleBTokenAddress,
            purchaseProgram: SPL_TOKEN_PROGRAM_ID
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        // Capture initial state before attempting invalid redemption
        const initialBuyerPurchaseBalance = getTokenAccountData(env.svm, buyerPurchaseTokenAddress).amount;
        const initialSaleBTokenBalance = getTokenAccountData(env.svm, saleBTokenAddress).amount;

        // Send the transaction (it should fail, but SVM doesn't throw errors)
        env.svm.sendTransaction(toWeb3JsTransaction(invalidRedeemTx));

        // Verify state remains unchanged (redemption failed)
        const finalBuyerPurchaseBalance = getTokenAccountData(env.svm, buyerPurchaseTokenAddress).amount;
        const finalSaleBTokenBalance = getTokenAccountData(env.svm, saleBTokenAddress).amount;

        // Verify balances didn't change (redemption failed)
        expect(Number(finalBuyerPurchaseBalance)).to.equal(Number(initialBuyerPurchaseBalance));
        expect(Number(finalSaleBTokenBalance)).to.equal(Number(initialSaleBTokenBalance));

        // Now redeem the receipt against the original Sale A (should succeed)
        const validRedeemTx = await EarlyPurchase.redeemReceipt(env.umi, {
            sale: saleAAddress, // Redeem against original Sale A
            receipt: receiptAddress,
            buyer: buyer,
            buyerPurchaseAta: buyerPurchaseTokenAddress,
            configPurchaseAta: saleATokenAddress,
            purchaseProgram: SPL_TOKEN_PROGRAM_ID
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(validRedeemTx));

        // Verify receipt was updated correctly
        const receiptSerializer = getReceiptAccountDataSerializer();
        const receiptAccount = env.svm.getAccount(toWeb3JsPublicKey(receiptAddress));
        const [finalReceipt] = receiptSerializer.deserialize(receiptAccount.data);

        expect(finalReceipt.numTokensRedeemed).to.equal(purchaseAmount);

        // Verify Sale A was updated correctly
        const finalSaleAAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAAddress));
        const [finalSaleA] = saleSerializer.deserialize(finalSaleAAccount.data);

        expect(finalSaleA.numTokensDistributed).to.equal(purchaseAmount);

        // Verify buyer received tokens
        const finalBuyerBalance = getTokenAccountData(env.svm, buyerPurchaseTokenAddress).amount;
        expect(Number(finalBuyerBalance)).to.equal(Number(purchaseAmount));
    });
});
