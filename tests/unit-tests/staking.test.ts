import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createTestMint,
    createUser,
    createPairAccounts,
    getTokenAccountData
} from "../helpers";

describe("liquid-staking: staking", () => {
    it.skip("should allow users to stake tokens", async () => {
        // Setup test environment
        const env = createTestEnvironment();

        // Create mint authority
        const mintAuthority = createUser(env.svm, env.umi);

        // Create base mint
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);

        // Create access control
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);

        // Create pair
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD"
        });

        // Create staker
        const staker = createUser(env.svm, env.umi);

        // Create and fund token accounts

        // Verify staking result
    });
});
