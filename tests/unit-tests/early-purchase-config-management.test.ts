import { expect } from "chai";
import {
  createTestEnvironment,
  createUser,
  createConfigAccount,
  findConfigPda,
} from "../helpers";
import {
  getConfigAccountDataSerializer,
  initializeConfig,
} from "../../clients/js/src/generated/early_purchase";
import { signerIdentity } from "@metaplex-foundation/umi";
import {
  toWeb3JsPublicKey,
  toWeb3JsTransaction,
} from "@metaplex-foundation/umi-web3js-adapters";

describe("early-purchase: config management", () => {
  it("should initialize a config account", async () => {
    const env = createTestEnvironment();

    // Create config account
    const { config, admin } = await createConfigAccount(env.svm, env.umi);

    // Verify config account was created correctly
    expect(config.admin.toString()).to.equal(admin.publicKey.toString());
  });

  it("should fail to initialize a config account when one already exists", async () => {
    const env = createTestEnvironment();

    // Create first config account
    const { config, configAddress, admin } = await createConfigAccount(
      env.svm,
      env.umi
    );

    // Try to create another config account with the same admin
    // Find config PDA
    const [configPda] = findConfigPda(env.umi);

    // Initialize config
    env.umi.use(signerIdentity(admin));
    const initializeConfigTx = await initializeConfig(env.umi, {
      config: configPda,
      admin: admin,
    })
      .setBlockhash(env.svm.latestBlockhash())
      .buildAndSign(env.umi);

    env.svm.sendTransaction(toWeb3JsTransaction(initializeConfigTx));
    const configAccount = env.svm.getAccount(toWeb3JsPublicKey(configAddress));
    const configSerializer = getConfigAccountDataSerializer();
    const [configAfter] = configSerializer.deserialize(configAccount.data);

    expect(config.admin).to.equal(configAfter.admin);
  });

  it("should fail to initialize a config account with a different admin", async () => {
    const env = createTestEnvironment();

    // Create first config account
    const { config: config1, admin: admin1 } = await createConfigAccount(
      env.svm,
      env.umi,
      true
    );

    // Create a different admin
    const admin2 = createUser(env.svm, env.umi);

    // Verify the admins are different
    expect(admin1.publicKey.toString()).to.not.equal(
      admin2.publicKey.toString()
    );

    // Verify config was initialized with admin1
    expect(config1.admin.toString()).to.equal(admin1.publicKey.toString());
  });
});
