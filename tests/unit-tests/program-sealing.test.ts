import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint,
    createPairAccounts,
} from "../helpers";

describe("program-sealing", () => {
    it.skip("should seal and unseal the program", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // TODO: Seal program
        // TODO: Attempt operation that should fail when sealed (e.g., create pair)
        // TODO: Verify operation fails
        // TODO: Unseal program
        // TODO: Attempt same operation
        // TODO: Verify operation succeeds
    });

    it.skip("should prevent unauthorized unsealing", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const unauthorizedUser = createUser(env.svm, env.umi);

        // TODO: Seal program with correct authority
        // TODO: Attempt to unseal with wrong authority
        // TODO: Verify unsealing fails
    });

    it.skip("should prevent operations when program is sealed", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD"
        });
        const staker = createUser(env.svm, env.umi);

        // TODO: Seal program
        // TODO: Attempt various operations (stake, create pair, etc.)
        // TODO: Verify all operations fail
    });
});
