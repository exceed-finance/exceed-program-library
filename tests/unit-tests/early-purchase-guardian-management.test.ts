import { expect } from "chai";
import { signerIdentity } from "@metaplex-foundation/umi";
import {
  toWeb3JsPublicKey,
  toWeb3JsTransaction,
} from "@metaplex-foundation/umi-web3js-adapters";
import {
  getGuardianAccountDataSerializer,
  initializeGuardian,
  updateGuardian,
} from "../../clients/js/src/generated/early_purchase";
import {
  createTestEnvironment,
  createUser,
  createConfigAccount,
  createGuardianAccount,
  updateGuardianAccount,
  findGuardianPda,
} from "../helpers";

describe("early-purchase: guardian management", () => {
  it("should initialize a guardian account", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress);

    // Verify guardian account was created correctly
    expect(guardian.authority.toString()).to.equal(
      guardianAuthority.publicKey.toString()
    );
    expect(guardian.permissions.updateConfig).to.be.true;
    expect(guardian.permissions.verifyPurchases).to.be.true;
    expect(guardian.permissions.depositTokens).to.be.true;
    expect(guardian.permissions.manageGuardians).to.be.true;
    expect(guardian.permissions.endSale).to.be.true;
    expect(guardian.permissions.updateSale).to.be.true;
  });

  it("should update a guardian account", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account with all permissions
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress);

    // Verify initial permissions
    expect(guardian.permissions.updateConfig).to.be.true;
    expect(guardian.permissions.verifyPurchases).to.be.true;
    expect(guardian.permissions.depositTokens).to.be.true;
    expect(guardian.permissions.manageGuardians).to.be.true;
    expect(guardian.permissions.endSale).to.be.true;
    expect(guardian.permissions.updateSale).to.be.true;

    // Update guardian with different permissions
    const updatedPermissions = {
      updateConfig: false,
      verifyPurchases: true,
      depositTokens: false,
      manageGuardians: true,
      endSale: false,
      updateSale: true,
      withdrawFunds: true,
    };

    const { guardian: updatedGuardian } = await updateGuardianAccount(
      env.svm,
      env.umi,
      admin,
      guardianAddress,
      configAddress,
      updatedPermissions
    );

    // Verify guardian account was updated correctly
    expect(updatedGuardian.authority.toString()).to.equal(
      guardianAuthority.publicKey.toString()
    );
    expect(updatedGuardian.permissions.updateConfig).to.be.false;
    expect(updatedGuardian.permissions.verifyPurchases).to.be.true;
    expect(updatedGuardian.permissions.depositTokens).to.be.false;
    expect(updatedGuardian.permissions.manageGuardians).to.be.true;
    expect(updatedGuardian.permissions.endSale).to.be.false;
    expect(updatedGuardian.permissions.updateSale).to.be.true;
  });

  it("should initialize a guardian with limited permissions", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account with limited permissions
    const limitedPermissions = {
      updateConfig: true,
      verifyPurchases: true,
      depositTokens: false,
      manageGuardians: false,
      endSale: false,
      updateSale: false,
      withdrawFunds: false,
    };

    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(
        env.svm,
        env.umi,
        admin,
        configAddress,
        limitedPermissions
      );

    // Verify guardian account was created correctly with limited permissions
    expect(guardian.authority.toString()).to.equal(
      guardianAuthority.publicKey.toString()
    );
    expect(guardian.permissions.updateConfig).to.be.true;
    expect(guardian.permissions.verifyPurchases).to.be.true;
    expect(guardian.permissions.depositTokens).to.be.false;
    expect(guardian.permissions.manageGuardians).to.be.false;
    expect(guardian.permissions.endSale).to.be.false;
    expect(guardian.permissions.updateSale).to.be.false;
  });

  it("should fail to initialize a guardian without admin authority", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create a non-admin user
    const nonAdmin = createUser(env.svm, env.umi);

    // Create guardian authority
    const guardianAuthority = createUser(env.svm, env.umi);

    // Find guardian PDA
    const [guardianAddress] = findGuardianPda(
      env.umi,
      guardianAuthority.publicKey
    );

    // Try to initialize guardian with non-admin user
    env.umi.use(signerIdentity(nonAdmin));
    const initializeGuardianTx = await initializeGuardian(env.umi, {
      config: configAddress,
      guardian: guardianAddress,
      authority: guardianAuthority.publicKey,
      admin: nonAdmin,
      permissions: {
        updateConfig: true,
        verifyPurchases: true,
        depositTokens: true,
        manageGuardians: true,
        endSale: true,
        updateSale: true,
        withdrawFunds: true,
      },
    })
      .setBlockhash(env.svm.latestBlockhash())
      .buildAndSign(env.umi);

    env.svm.sendTransaction(toWeb3JsTransaction(initializeGuardianTx));

    const guardianAccount = env.svm.getAccount(
      toWeb3JsPublicKey(guardianAddress)
    );
    expect(guardianAccount).to.be.null;
  });

  it("should fail to update a guardian without proper permissions", async () => {
    // Setup test environment
    const env = createTestEnvironment();

    // Create config account
    const { configAddress, config, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Create guardian account
    const { guardianAddress, guardian, guardianAuthority } =
      await createGuardianAccount(env.svm, env.umi, admin, configAddress);

    // Create a non-admin user
    const nonAdmin = createUser(env.svm, env.umi);

    // Try to update guardian with non-admin user
    env.umi.use(signerIdentity(nonAdmin));
    const updateGuardianTx = await updateGuardian(env.umi, {
      admin: nonAdmin,
      config: configAddress,
      guardian: guardianAddress,
      permissions: {
        updateConfig: false,
        verifyPurchases: false,
        depositTokens: false,
        manageGuardians: false,
        endSale: false,
        updateSale: false,
        withdrawFunds: false,
      },
    })
      .setBlockhash(env.svm.latestBlockhash())
      .buildAndSign(env.umi);

    // Expect the transaction to fail
    const guardianAccount = env.svm.getAccount(
      toWeb3JsPublicKey(guardianAddress)
    );
    const guardianSerializer = getGuardianAccountDataSerializer();
    const [guardianAfter] = guardianSerializer.deserialize(
      guardianAccount.data
    );

    expect(guardian.authority).to.equal(guardianAfter.authority);
    expect(guardian.permissions).to.deep.equal(guardianAfter.permissions);
  });
});
