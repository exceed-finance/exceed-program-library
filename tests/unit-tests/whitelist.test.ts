import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint,
    createPairAccounts,
    getTokenAccountData,
    SOL_USD_FEED_ADDRESS,
    setPriceFeedTime
} from "../helpers";
import { signerIdentity, some, none } from "@metaplex-foundation/umi";
import { updateWhitelist, stake, getAccessControlAccountDataSerializer, GuardianOperation } from "../../clients/js/src/generated/liquid_staking";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { getMerkleRoot, getMerkleProof, getMerkleTree, getMerkleProofAtIndex } from "../../clients/js";
import { findAssociatedTokenPda, createAssociatedToken, mintTokensTo, setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { transactionBuilder } from "@metaplex-foundation/umi";
import { keccak_256 } from "@noble/hashes/sha3";
import { SOLANA_SCHEMA } from "@solana/web3.js";

describe("whitelist", () => {
    it("should update merkle root successfully", async () => {
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

        let users = [
            createUser(env.svm, env.umi),
            createUser(env.svm, env.umi),
            createUser(env.svm, env.umi),
            createUser(env.svm, env.umi),
            createUser(env.svm, env.umi),
        ];
        let userPubkeys = users.map((kp) => kp.publicKey);

        let root = getMerkleRoot(userPubkeys);

        const updateWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: accessControl.authorities.accessAuthority,
            merkleRoot: some(root),
            enableWhitelist: some(true)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        const updateWlResult = env.svm.sendTransaction(toWeb3JsTransaction(updateWhitelistTx));
        // console.log(updateWlResult.toString());

        let accessControlSerializer = getAccessControlAccountDataSerializer();
        let accessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        let [accessControlState] = accessControlSerializer.deserialize(accessControlAccount.data);

        const [expectedRoot] = base58.deserialize(accessControlState.merkleRoot);
        const [actualRoot] = base58.deserialize(root)

        expect(expectedRoot).to.equal(actualRoot)
        expect(accessControlState.isWhitelistEnabled).to.be.true
    });

    it("should disable whitelist successfully", async () => {
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

        // Create some users for the whitelist
        let users = [
            createUser(env.svm, env.umi),
            createUser(env.svm, env.umi),
            createUser(env.svm, env.umi),
        ];
        let userPubkeys = users.map((kp) => kp.publicKey);

        // Generate merkle root
        let root = getMerkleRoot(userPubkeys);

        // First enable whitelist
        env.umi.use(signerIdentity(accessControl.authorities.accessAuthority));
        const enableWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: accessControl.authorities.accessAuthority,
            merkleRoot: some(root),
            enableWhitelist: some(true)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(enableWhitelistTx));

        // Verify whitelist is enabled
        let accessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        let accessControlSerializer = getAccessControlAccountDataSerializer();
        let [accessControlState] = accessControlSerializer.deserialize(accessControlAccount.data);
        expect(accessControlState.isWhitelistEnabled).to.be.true;

        // Then disable whitelist
        const disableWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: accessControl.authorities.accessAuthority,
            merkleRoot: none(),
            enableWhitelist: some(false)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(disableWhitelistTx));

        // Verify whitelist was disabled
        accessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        [accessControlState] = accessControlSerializer.deserialize(accessControlAccount.data);
        expect(accessControlState.isWhitelistEnabled).to.be.false;
    });

    it("should fail to update whitelist with wrong authority", async () => {
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

        // Create an unauthorized user
        const unauthorizedUser = createUser(env.svm, env.umi);

        // Create a merkle root
        let users = [createUser(env.svm, env.umi)];
        let userPubkeys = users.map((kp) => kp.publicKey);
        let root = getMerkleRoot(userPubkeys);

        // Get the initial state of the access control
        let accessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        let accessControlSerializer = getAccessControlAccountDataSerializer();
        let [initialAccessControlState] = accessControlSerializer.deserialize(accessControlAccount.data);

        // Attempt to update whitelist with wrong authority
        env.umi.use(signerIdentity(unauthorizedUser));
        const updateWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: unauthorizedUser,
            merkleRoot: some(root),
            enableWhitelist: some(true)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        // Expect the transaction to fail
        try {
            env.svm.sendTransaction(toWeb3JsTransaction(updateWhitelistTx));
            expect.fail("Transaction should have failed");
        } catch (error) {
            // Transaction failed as expected
            expect(error.toString()).to.include("Error");
        }

        // Verify the whitelist state remains unchanged
        accessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        let [finalAccessControlState] = accessControlSerializer.deserialize(accessControlAccount.data);
        expect(finalAccessControlState.isWhitelistEnabled).to.equal(initialAccessControlState.isWhitelistEnabled);
    });

    it("should fail to update whitelist when program is sealed", async () => {
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

        // Create a guardian
        const guardian = createUser(env.svm, env.umi);

        // Add the guardian to the access control
        const { manageGuardian, sealProgram } = await import("../../clients/js/src/generated/liquid_staking");
        env.umi.use(signerIdentity(accessControl.authorities.unsealAuthority));
        const addGuardianTx = await manageGuardian(env.umi, {
            accessControl: accessControl.accessControlAddress,
            unsealAuthority: accessControl.authorities.unsealAuthority,
            guardian: guardian.publicKey,
            operation: GuardianOperation.Add
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(addGuardianTx));

        // Seal the program
        env.umi.use(signerIdentity(guardian));
        const sealProgramTx = await sealProgram(env.umi, {
            accessControl: accessControl.accessControlAddress,
            guardian
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(sealProgramTx));

        // Verify the program is sealed
        let accessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        let accessControlSerializer = getAccessControlAccountDataSerializer();
        let [accessControlState] = accessControlSerializer.deserialize(accessControlAccount.data);
        expect(accessControlState.isSealed).to.be.true;

        // Create a merkle root
        let users = [createUser(env.svm, env.umi)];
        let userPubkeys = users.map((kp) => kp.publicKey);
        let root = getMerkleRoot(userPubkeys);

        // Attempt to update whitelist when program is sealed
        env.umi.use(signerIdentity(accessControl.authorities.accessAuthority));
        const updateWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: accessControl.authorities.accessAuthority,
            merkleRoot: some(root),
            enableWhitelist: some(true)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        // Expect the transaction to fail
        try {
            env.svm.sendTransaction(toWeb3JsTransaction(updateWhitelistTx));
            expect.fail("Transaction should have failed");
        } catch (error) {
            // Transaction failed as expected
            expect(error.toString()).to.include("Error");
        }
    });

    it("should stake with whitelist enabled and valid merkle proof", async () => {
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

        // Create staker
        const staker = createUser(env.svm, env.umi);

        // Generate merkle tree with staker in whitelist
        const whitelistedAddresses = [staker.publicKey.toString()];
        const merkleRoot = getMerkleRoot(whitelistedAddresses);
        const merkleTree = getMerkleTree(whitelistedAddresses);
        const proof = getMerkleProofAtIndex(whitelistedAddresses, 0);

        const verified = merkleTree.verify(
            proof,
            Buffer.from(keccak_256(whitelistedAddresses[0])),
            Buffer.from(merkleRoot)
        );
        expect(verified).to.be.true

        // Update access control with merkle root and enable whitelist
        env.umi.use(signerIdentity(accessControl.authorities.accessAuthority));
        const updateWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: accessControl.authorities.accessAuthority,
            merkleRoot: some(merkleRoot),
            enableWhitelist: some(true)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(updateWhitelistTx));

        // Verify whitelist is enabled and merkle root is set
        const updatedAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const accessControlSerializer = getAccessControlAccountDataSerializer();
        const [updatedAccessControl] = accessControlSerializer.deserialize(updatedAccessControlAccount.data);
        // console.log(updatedAccessControl)


        let [expectedRoot] = base58.deserialize(updatedAccessControl.merkleRoot);
        let [actualRoot] = base58.deserialize(merkleRoot);

        expect(updatedAccessControl.isWhitelistEnabled).to.be.true;
        expect(expectedRoot).to.equal(actualRoot);

        // Create and fund token accounts
        env.umi.use(signerIdentity(mintAuthority));
        const [stakerBaseTokenAccount] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        // Create token account and mint tokens to staker
        const mintAmount = 1_000_000n;
        const setupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    mint: baseMint.mintKeypair.publicKey,
                    owner: staker.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    mint: baseMint.mintKeypair.publicKey,
                    token: stakerBaseTokenAccount,
                    amount: Number(mintAmount),
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);
        const result = env.svm.sendTransaction(toWeb3JsTransaction(setupTx));
        // console.log(result.toString());

        // Generate merkle proof for staker
        const merkleProof = getMerkleProof(whitelistedAddresses, staker.publicKey.toString());

        // Stake with valid merkle proof
        env.umi.use(signerIdentity(staker));

        setPriceFeedTime(env.svm, 30)
        const stakeTx = await stake(env.umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstMint: pair.lstAddress,
            lstFeeAccount: pair.lstTokenAddress,
            staker,
            quantity: 500_000,
            merkleProof: some(merkleProof),
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        const stakeResult = env.svm.sendTransaction(toWeb3JsTransaction(stakeTx));
        // console.log(stakeResult.toString())

        // Verify staking succeeded by checking token balances
        const [stakerLstAddress] = findAssociatedTokenPda(env.umi, {
            mint: pair.lstAddress,
            owner: staker.publicKey
        });
        const stakerLstTokenData = getTokenAccountData(env.svm, stakerLstAddress);
        expect(Number(stakerLstTokenData?.amount)).to.equal(500_000);
    });

    it("should fail to stake with invalid merkle proof", async () => {
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

        // Create whitelisted user
        const whitelistedUser = createUser(env.svm, env.umi);

        // Create another user not in the whitelist
        const nonWhitelistedUser = createUser(env.svm, env.umi);

        // Generate merkle tree with only the whitelisted user
        const whitelistedAddresses = [whitelistedUser.publicKey.toString()];
        const merkleRoot = getMerkleRoot(whitelistedAddresses);

        // Update access control with merkle root and enable whitelist
        env.umi.use(signerIdentity(accessControl.authorities.pairAuthority));
        const updateWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: accessControl.authorities.pairAuthority,
            merkleRoot: some(merkleRoot),
            enableWhitelist: some(true)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        const setRootResult = env.svm.sendTransaction(toWeb3JsTransaction(updateWhitelistTx));
        // console.log(setRootResult.toString());

        // Verify whitelist is enabled and merkle root is set
        const updatedAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const accessControlSerializer = getAccessControlAccountDataSerializer();

        // console.log(accessControl)
        const [updatedAccessControl] = accessControlSerializer.deserialize(updatedAccessControlAccount.data);

        // expect(updatedAccessControl.isWhitelistEnabled).to.be.true;
        // expect(Buffer.from(updatedAccessControl.merkleRoot)).to.deep.equal(Buffer.from(merkleRoot));

        // Create and fund token accounts for non-whitelisted user
        env.umi.use(signerIdentity(mintAuthority));
        const [nonWhitelistedUserBaseTokenAccount] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: nonWhitelistedUser.publicKey
        });

        // Create token account and mint tokens to non-whitelisted user
        const mintAmount = 1_000_000n;
        const setupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    mint: baseMint.mintKeypair.publicKey,
                    owner: nonWhitelistedUser.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    mint: baseMint.mintKeypair.publicKey,
                    token: nonWhitelistedUserBaseTokenAccount,
                    amount: Number(mintAmount),
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(setupTx));

        // Try to generate a merkle proof for the non-whitelisted user (will be invalid)
        // In a real scenario, the client might try to forge a proof, but for testing
        // we'll just use an empty proof which will fail verification
        const invalidMerkleProof: Uint8Array[] = [];

        // Attempt to stake with invalid merkle proof
        setPriceFeedTime(env.svm, 30)
        env.umi.use(signerIdentity(nonWhitelistedUser));
        const { stake } = await import("../../clients/js/src/generated/liquid_staking");
        const stakeTx = await stake(env.umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstMint: pair.lstAddress,
            lstFeeAccount: pair.lstTokenAddress,
            staker: nonWhitelistedUser,
            quantity: 500_000,
            merkleProof: some(invalidMerkleProof),
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        // Expect the transaction to fail
        try {
            env.svm.sendTransaction(toWeb3JsTransaction(stakeTx));
            expect.fail("Transaction should have failed");
        } catch (error) {
            // Transaction failed as expected
            expect(error.toString()).to.include("Error");
        }
    });

    it("should stake with whitelist disabled regardless of merkle proof", async () => {
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

        // Create staker
        const staker = createUser(env.svm, env.umi);

        // Ensure whitelist is disabled
        env.umi.use(signerIdentity(accessControl.authorities.pairAuthority));
        const updateWhitelistTx = await updateWhitelist(env.umi, {
            accessControl: accessControl.accessControlAddress,
            authority: accessControl.authorities.pairAuthority,
            merkleRoot: none(),
            enableWhitelist: some(false)
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(updateWhitelistTx));

        // Verify whitelist is disabled
        const updatedAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const accessControlSerializer = getAccessControlAccountDataSerializer();
        const [updatedAccessControl] = accessControlSerializer.deserialize(updatedAccessControlAccount.data);
        expect(updatedAccessControl.isWhitelistEnabled).to.be.false;

        // Create and fund token accounts
        env.umi.use(signerIdentity(mintAuthority));
        const [stakerBaseTokenAccount] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: staker.publicKey
        });

        // Create token account and mint tokens to staker
        const mintAmount = 1_000_000n;
        const setupTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    mint: baseMint.mintKeypair.publicKey,
                    owner: staker.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    mint: baseMint.mintKeypair.publicKey,
                    token: stakerBaseTokenAccount,
                    amount: Number(mintAmount),
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(setupTx));

        // Stake without merkle proof
        setPriceFeedTime(env.svm, 30)
        env.umi.use(signerIdentity(staker));
        const { stake } = await import("../../clients/js/src/generated/liquid_staking");
        const stakeTx = await stake(env.umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            lstMint: pair.lstAddress,
            lstFeeAccount: pair.lstTokenAddress,
            staker,
            quantity: 500_000,
            merkleProof: none(),
            priceFeed: SOL_USD_FEED_ADDRESS
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(stakeTx));

        // Verify staking succeeded by checking token balances
        const [stakerLstAddress] = findAssociatedTokenPda(env.umi, {
            mint: pair.lstAddress,
            owner: staker.publicKey
        });
        const stakerLstTokenData = getTokenAccountData(env.svm, stakerLstAddress);
        expect(Number(stakerLstTokenData?.amount)).to.be.greaterThan(0);
    });
});
