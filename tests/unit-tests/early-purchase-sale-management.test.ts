import { expect } from "chai";
import { addDays, getUnixTime } from "date-fns";
import { signerIdentity, unwrapOption } from "@metaplex-foundation/umi";
import {
  toWeb3JsPublicKey,
  toWeb3JsTransaction,
} from "@metaplex-foundation/umi-web3js-adapters";
import {
  initializeSale,
  updateSale,
  endSale,
  SaleState,
  getSaleAccountDataSerializer,
} from "../../clients/js/src/generated/early_purchase";
import {
  createTestEnvironment,
  createUser,
  createConfigAccount,
  createGuardianAccount,
  createSaleAccount,
  createTestMint,
  updateSaleAccount,
  endSaleAccount,
  findSalePda,
} from "../helpers";
import { SPL_TOKEN_PROGRAM_ID } from "@metaplex-foundation/mpl-toolbox";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("early-purchase: sale management", () => {
  it("should initialize a sale", async () => {
    // TODO: Test initializing a sale
    // Setup test environment
    const env = createTestEnvironment();

    // Create mint authority
    const mintAuthority = createUser(env.svm, env.umi);

    // Create purchase and payment mints
    const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
    const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress);

    // Create sale account
    const startTime = addDays(env.currentTime, 1);
    const endTime = addDays(startTime, 7);

    const { saleAddress, sale } = await createSaleAccount(env.svm, env.umi, {
      admin,
      purchaseMint: purchaseMint.mintKeypair.publicKey,
      paymentMint: paymentMint.mintKeypair.publicKey,
      paymentAmount: 1000000n,
      priceFeedIdHex:
        "0000000000000000000000000000000000000000000000000000000000000000",
      maxPriceFeedAge: 300n,
      guardPurchases: true,
      maxTokensTotal: 1000000000n,
      maxTokensPerUser: 10000000n,
      startTimestamp: BigInt(getUnixTime(startTime)),
      endTimestamp: BigInt(getUnixTime(endTime)),
    });

    // Verify sale account was created correctly
    expect(sale.state).to.equal(0); // 0 represents the Active state
    expect(sale.guardPurchases).to.be.true;
    expect(unwrapOption(sale.maxTokensTotal).toString()).to.equal("1000000000");
    expect(unwrapOption(sale.maxTokensPerUser).toString()).to.equal("10000000");
    expect(unwrapOption(sale.startTimestamp).toString()).to.equal(
      getUnixTime(startTime).toString()
    );
    expect(unwrapOption(sale.endTimestamp).toString()).to.equal(
      getUnixTime(endTime).toString()
    );
    expect(sale.purchaseMint.toString()).to.equal(
      purchaseMint.mintKeypair.publicKey.toString()
    );
    expect(sale.purchaseProgram.toString()).to.equal(
      SPL_TOKEN_PROGRAM_ID.toString()
    );
    expect(sale.paymentMint.toString()).to.equal(
      paymentMint.mintKeypair.publicKey.toString()
    );
    expect(sale.paymentProgram.toString()).to.equal(
      SPL_TOKEN_PROGRAM_ID.toString()
    );
    expect(sale.paymentAmount).to.equal(1000000n);
    expect(sale.numTokensPurchased).to.equal(0n);
    expect(sale.numTokensDeposited).to.equal(0n);
    expect(sale.numTokensDistributed).to.equal(0n);
  });

  it("should update a sale", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create mint authority
    const mintAuthority = createUser(env.svm, env.umi);

    // Create purchase and payment mints
    const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
    const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account with update_sale permission
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress, {
        updateConfig: false,
        verifyPurchases: false,
        depositTokens: false,
        manageGuardians: false,
        endSale: false,
        updateSale: true,
        withdrawFunds: false,
      });

    // Create sale account
    const startTime = addDays(env.currentTime, 1);
    const endTime = addDays(startTime, 7);

    const { saleAddress, sale } = await createSaleAccount(env.svm, env.umi, {
      admin,
      purchaseMint: purchaseMint.mintKeypair.publicKey,
      paymentMint: paymentMint.mintKeypair.publicKey,
      paymentAmount: 1000000n,
      priceFeedIdHex:
        "0000000000000000000000000000000000000000000000000000000000000000",
      maxPriceFeedAge: 300n,
      guardPurchases: true,
      maxTokensTotal: 1000000000n,
      maxTokensPerUser: 10000000n,
      startTimestamp: BigInt(getUnixTime(startTime)),
      endTimestamp: BigInt(getUnixTime(endTime)),
    });

    // Verify initial sale state
    expect(sale.guardPurchases).to.be.true;
    expect(unwrapOption(sale.maxTokensTotal).toString()).to.equal("1000000000");
    expect(unwrapOption(sale.maxTokensPerUser).toString()).to.equal("10000000");
    expect(sale.paymentAmount).to.equal(1000000n);

    // Update sale with new values
    const newStartTime = addDays(env.currentTime, 2);
    const newEndTime = addDays(newStartTime, 10);

    const { sale: updatedSale } = await updateSaleAccount(env.svm, env.umi, {
      authority: guardianAuthority,
      guardian: guardianAddress,
      sale: saleAddress,
      guardPurchases: false,
      paymentAmount: 2000000n,
      maxTokensTotal: 2000000000n,
      maxTokensPerUser: 20000000n,
      startTimestamp: BigInt(getUnixTime(newStartTime)),
      endTimestamp: BigInt(getUnixTime(newEndTime)),
    });

    // Verify sale account was updated correctly
    expect(updatedSale.guardPurchases).to.be.false;
    expect(unwrapOption(updatedSale.maxTokensTotal).toString()).to.equal(
      "2000000000"
    );
    expect(unwrapOption(updatedSale.maxTokensPerUser).toString()).to.equal(
      "20000000"
    );
    expect(unwrapOption(updatedSale.startTimestamp).toString()).to.equal(
      getUnixTime(newStartTime).toString()
    );
    expect(unwrapOption(updatedSale.endTimestamp).toString()).to.equal(
      getUnixTime(newEndTime).toString()
    );
    expect(updatedSale.paymentAmount).to.equal(2000000n);

    // Verify unchanged fields
    expect(updatedSale.purchaseMint.toString()).to.equal(
      purchaseMint.mintKeypair.publicKey.toString()
    );
    expect(updatedSale.purchaseProgram.toString()).to.equal(
      SPL_TOKEN_PROGRAM_ID.toString()
    );
    expect(updatedSale.paymentMint.toString()).to.equal(
      paymentMint.mintKeypair.publicKey.toString()
    );
    expect(updatedSale.paymentProgram.toString()).to.equal(
      SPL_TOKEN_PROGRAM_ID.toString()
    );
    expect(updatedSale.numTokensPurchased).to.equal(0n);
    expect(updatedSale.numTokensDeposited).to.equal(0n);
    expect(updatedSale.numTokensDistributed).to.equal(0n);
  });

  it("should end a sale", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create mint authority
    const mintAuthority = createUser(env.svm, env.umi);

    // Create purchase and payment mints
    const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
    const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account with end_sale permission
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress, {
        updateConfig: false,
        verifyPurchases: false,
        depositTokens: false,
        manageGuardians: false,
        endSale: true,
        updateSale: false,
        withdrawFunds: false,
      });

    // Create sale account
    const startTime = addDays(env.currentTime, 1);
    const endTime = addDays(startTime, 7);

    const { saleAddress, sale } = await createSaleAccount(env.svm, env.umi, {
      admin,
      purchaseMint: purchaseMint.mintKeypair.publicKey,
      paymentMint: paymentMint.mintKeypair.publicKey,
      paymentAmount: 1000000n,
      priceFeedIdHex:
        "0000000000000000000000000000000000000000000000000000000000000000",
      maxPriceFeedAge: 300n,
      guardPurchases: true,
      maxTokensTotal: 1000000000n,
      maxTokensPerUser: 10000000n,
      startTimestamp: BigInt(getUnixTime(startTime)),
      endTimestamp: BigInt(getUnixTime(endTime)),
    });

    // Verify initial sale state
    expect(sale.state).to.equal(SaleState.Active);

    // End the sale
    const { sale: endedSale } = await endSaleAccount(
      env.svm,
      env.umi,
      guardianAuthority,
      guardianAddress,
      saleAddress
    );

    // Verify sale was ended
    expect(endedSale.state).to.equal(SaleState.Ended);

    // Verify other fields remain unchanged
    expect(endedSale.guardPurchases).to.equal(sale.guardPurchases);
    expect(unwrapOption(endedSale.maxTokensTotal)).to.equal(
      unwrapOption(sale.maxTokensTotal)
    );
    expect(unwrapOption(endedSale.maxTokensPerUser)).to.equal(
      unwrapOption(sale.maxTokensPerUser)
    );
    expect(unwrapOption(endedSale.startTimestamp)).to.equal(
      unwrapOption(sale.startTimestamp)
    );
    expect(unwrapOption(endedSale.endTimestamp)).to.equal(
      unwrapOption(sale.endTimestamp)
    );
    expect(endedSale.purchaseMint.toString()).to.equal(
      sale.purchaseMint.toString()
    );
    expect(endedSale.paymentMint.toString()).to.equal(
      sale.paymentMint.toString()
    );
    expect(endedSale.paymentAmount).to.equal(sale.paymentAmount);
  });

  it("should fail to initialize a sale without proper permissions", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create mint authority
    const mintAuthority = createUser(env.svm, env.umi);

    // Create purchase and payment mints
    const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
    const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create a non-admin user
    const nonAdmin = createUser(env.svm, env.umi);

    // Find sale PDA
    const saleId = 1;
    const [saleAddress] = findSalePda(env.umi, saleId);

    env.umi.use(signerIdentity(nonAdmin));
    const startTime = addDays(env.currentTime, 1);
    const endTime = addDays(startTime, 7);

    const initializeSaleTx = await initializeSale(env.umi, {
      admin: nonAdmin,
      sale: saleAddress,
      purchaseMint: purchaseMint.mintKeypair.publicKey,
      paymentMint: paymentMint.mintKeypair.publicKey,
      id: 1,
      paymentAmount: 1000000n,
      priceFeedIdHex:
        "0000000000000000000000000000000000000000000000000000000000000000",
      maxPriceFeedAge: 300n,
      guardPurchases: true,
      maxTokensTotal: 1000000000n,
      maxTokensPerUser: 10000000n,
      startTimestamp: BigInt(getUnixTime(startTime)),
      endTimestamp: BigInt(getUnixTime(endTime)),
    })
      .setBlockhash(env.svm.latestBlockhash())
      .buildAndSign(env.umi);

    env.svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));
    const saleAccount = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
    expect(saleAccount).to.be.null;
  });

  it("should fail to update a sale without proper permissions", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create mint authority
    const mintAuthority = createUser(env.svm, env.umi);

    // Create purchase and payment mints
    const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
    const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account WITHOUT update_sale permission
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress, {
        updateConfig: true,
        verifyPurchases: true,
        depositTokens: true,
        manageGuardians: true,
        endSale: true,
        withdrawFunds: true,
        updateSale: false, // No permission to update sale
      });

    // Create sale account
    const startTime = addDays(env.currentTime, 1);
    const endTime = addDays(startTime, 7);

    const { saleAddress, sale } = await createSaleAccount(env.svm, env.umi, {
      admin,
      purchaseMint: purchaseMint.mintKeypair.publicKey,
      paymentMint: paymentMint.mintKeypair.publicKey,
      paymentAmount: 1000000n,
      priceFeedIdHex:
        "0000000000000000000000000000000000000000000000000000000000000000",
      maxPriceFeedAge: 300n,
      guardPurchases: true,
      maxTokensTotal: 1000000000n,
      maxTokensPerUser: 10000000n,
      startTimestamp: BigInt(getUnixTime(startTime)),
      endTimestamp: BigInt(getUnixTime(endTime)),
    });

    // Capture the initial sale data
    const saleAccountBefore = env.svm.getAccount(
      toWeb3JsPublicKey(saleAddress)
    );
    const saleSerializer = getSaleAccountDataSerializer();
    const [saleBefore] = saleSerializer.deserialize(saleAccountBefore.data);

    // Try to update sale with guardian that doesn't have update_sale permission
    env.umi.use(signerIdentity(guardianAuthority));
    const newStartTime = addDays(env.currentTime, 2);
    const newEndTime = addDays(newStartTime, 10);

    const updateSaleTx = await updateSale(env.umi, {
      authority: guardianAuthority,
      guardian: guardianAddress,
      sale: saleAddress,
      guardPurchases: false,
      paymentAmount: 2000000n,
      maxTokensTotal: 2000000000n,
      maxTokensPerUser: 20000000n,
      startTimestamp: BigInt(getUnixTime(newStartTime)),
      endTimestamp: BigInt(getUnixTime(newEndTime)),
      maxPriceFeedAge: LAMPORTS_PER_SOL
    })
      .setBlockhash(env.svm.latestBlockhash())
      .buildAndSign(env.umi);

    // Send the transaction (it should fail, but SVM doesn't throw errors)
    env.svm.sendTransaction(toWeb3JsTransaction(updateSaleTx));

    // Verify the sale data remains unchanged
    const saleAccountAfter = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
    const [saleAfter] = saleSerializer.deserialize(saleAccountAfter.data);

    // Assert that key fields are unchanged
    expect(saleAfter.guardPurchases).to.equal(saleBefore.guardPurchases);
    expect(unwrapOption(saleAfter.maxTokensTotal)).to.equal(
      unwrapOption(saleBefore.maxTokensTotal)
    );
    expect(unwrapOption(saleAfter.maxTokensPerUser)).to.equal(
      unwrapOption(saleBefore.maxTokensPerUser)
    );
    expect(unwrapOption(saleAfter.startTimestamp)).to.equal(
      unwrapOption(saleBefore.startTimestamp)
    );
    expect(unwrapOption(saleAfter.endTimestamp)).to.equal(
      unwrapOption(saleBefore.endTimestamp)
    );
    expect(saleAfter.paymentAmount).to.equal(saleBefore.paymentAmount);
  });

  it("should fail to end a sale without proper permissions", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create mint authority
    const mintAuthority = createUser(env.svm, env.umi);

    // Create purchase and payment mints
    const purchaseMint = await createTestMint(env.svm, env.umi, mintAuthority);
    const paymentMint = await createTestMint(env.svm, env.umi, mintAuthority);

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account WITHOUT end_sale permission
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress, {
        updateConfig: true,
        verifyPurchases: true,
        depositTokens: true,
        manageGuardians: true,
        endSale: false, // No permission to end sale
        updateSale: true,
        withdrawFunds: true,
      });

    // Create sale account
    const startTime = addDays(env.currentTime, 1);
    const endTime = addDays(startTime, 7);

    const { saleAddress, sale } = await createSaleAccount(env.svm, env.umi, {
      admin,
      purchaseMint: purchaseMint.mintKeypair.publicKey,
      paymentMint: paymentMint.mintKeypair.publicKey,
      paymentAmount: 1000000n,
      priceFeedIdHex:
        "0000000000000000000000000000000000000000000000000000000000000000",
      maxPriceFeedAge: 300n,
      guardPurchases: true,
      maxTokensTotal: 1000000000n,
      maxTokensPerUser: 10000000n,
      startTimestamp: BigInt(getUnixTime(startTime)),
      endTimestamp: BigInt(getUnixTime(endTime)),
    });

    // Capture the initial sale state
    const saleAccountBefore = env.svm.getAccount(
      toWeb3JsPublicKey(saleAddress)
    );
    const saleSerializer = getSaleAccountDataSerializer();
    const [saleBefore] = saleSerializer.deserialize(saleAccountBefore.data);

    // Verify initial state is Active
    expect(saleBefore.state).to.equal(SaleState.Active);

    // Try to end sale with guardian that doesn't have end_sale permission
    env.umi.use(signerIdentity(guardianAuthority));
    const endSaleTx = await endSale(env.umi, {
      authority: guardianAuthority,
      guardian: guardianAddress,
      sale: saleAddress,
    })
      .setBlockhash(env.svm.latestBlockhash())
      .buildAndSign(env.umi);

    // Send the transaction (it should fail, but SVM doesn't throw errors)
    env.svm.sendTransaction(toWeb3JsTransaction(endSaleTx));

    // Verify the sale state remains unchanged
    const saleAccountAfter = env.svm.getAccount(toWeb3JsPublicKey(saleAddress));
    const [saleAfter] = saleSerializer.deserialize(saleAccountAfter.data);

    // Assert that the sale state is still Active (unchanged)
    expect(saleAfter.state).to.equal(SaleState.Active);
  });
});
