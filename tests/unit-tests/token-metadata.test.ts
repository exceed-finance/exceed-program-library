import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint,
    createPairAccounts
} from "../helpers";
import { createTokenMetadata, createPair, getPairAccountDataSerializer } from "../../clients/js/src/generated/liquid_staking";
import { findLstPda, findPairPda } from "../../clients/js";
import { TokenStandard, findMetadataPda, getMetadataAccountDataSerializer, MPL_TOKEN_METADATA_PROGRAM_ID, createV1 } from "@metaplex-foundation/mpl-token-metadata";
import { toWeb3JsPublicKey, toWeb3JsTransaction, fromWeb3JsPublicKey, fromWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { generateSigner, unwrapOption } from "@metaplex-foundation/umi";
import { createInitializeMint2Instruction, createMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";

describe("token-metadata", () => {
    it("should create metadata for token program pair", async () => {
        // Setup
        const { svm, umi } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint = await createTestMint(svm, umi, mintAuthority);

        const pair = await createPairAccounts(svm, umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD"
        });

        const [metadataAddress] = findMetadataPda(umi, { mint: pair.lstAddress });
        // TODO: Create metadata for LST token
        const createMetadataTx = await createTokenMetadata(umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            lstMint: pair.lstAddress,
            metadata: metadataAddress,
            name: "Nil USD",
            uri: "http://localhost:8080/metadata",
            pair: pair.pairAddress,
            sysvarInstructions: fromWeb3JsPublicKey(SYSVAR_INSTRUCTIONS_PUBKEY)
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const createMetadataResult = svm.sendTransaction(toWeb3JsTransaction(createMetadataTx))
        // console.log(createMetadataResult.toString())

        const metadataSerializer = getMetadataAccountDataSerializer();
        const metadataAccount = svm.getAccount(toWeb3JsPublicKey(metadataAddress))
        const [metadata] = metadataSerializer.deserialize(metadataAccount.data);

        expect(unwrapOption(metadata.tokenStandard)).to.equal(TokenStandard.Fungible);

    });

    it("should create token metadata for token 2022 program mints", async () => {
        // Setup
        const { svm, umi } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const mintAuthority = createUser(svm, umi);
        const baseMint2 = generateSigner(umi);

        const createTx = await createV1(umi, {
            mint: baseMint2,
            name: "b2",
            uri: "http://localhost:8080/base2.json",
            sellerFeeBasisPoints: {
                basisPoints: 0n,
                identifier: "%",
                decimals: 2
            },
            splTokenProgram: fromWeb3JsPublicKey(TOKEN_2022_PROGRAM_ID)
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const createResult = svm.sendTransaction(toWeb3JsTransaction(createTx))
        // console.log(createResult.toString())

        // Derive PDAs for LST mint and pair
        const symbol = "NILUSD";
        const [lstAddress, lstBump] = findLstPda(umi, symbol);
        const [pairAddress, pairBump] = findPairPda(umi, baseMint2.publicKey, lstAddress);

        const pairBaseTokenAddress = findAssociatedTokenPda(umi, {
            mint: baseMint2.publicKey,
            owner: pairAddress,
            tokenProgramId: fromWeb3JsPublicKey(TOKEN_2022_PROGRAM_ID),
        })

        const pairLstFeeAddress = findAssociatedTokenPda(umi, {
            mint: lstAddress,
            owner: pairAddress,
            tokenProgramId: fromWeb3JsPublicKey(TOKEN_2022_PROGRAM_ID)
        });
        // Create pair directly without using the helper
        const createPairTx = await createPair(umi, {
            pair: pairAddress,
            lstMint: lstAddress,
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControl: accessControl.accessControlAddress,
            baseTokenMint: baseMint2.publicKey,
            symbol,
            intervalAprRate: 1000044558220n, // 5% APY with 8-hour intervals
            secondsPerInterval: 8 * 60 * 60, // 8 hours in seconds
            initialExchangeRate: 1000000000000n, // PRECISION
            depositCap: 1000000000n,
            minimumDeposit: 100000n,
            stakeFeeBps: 0,
            swapFeeBps: 0,
            withdrawFeeBps: 100,
            tokenProgram: fromWeb3JsPublicKey(TOKEN_2022_PROGRAM_ID),
            pairBaseTokenAccount: pairBaseTokenAddress,
            lstFeeAccount: pairLstFeeAddress
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const createPairResult = svm.sendTransaction(toWeb3JsTransaction(createPairTx));
        // console.log("Create pair result:", createPairResult.toString());

        // Verify pair was created correctly
        const pairSerializer = getPairAccountDataSerializer();
        const pairAccount = svm.getAccount(toWeb3JsPublicKey(pairAddress));
        const [pair] = pairSerializer.deserialize(pairAccount.data);

        expect(pair.lstSymbol).to.equal(symbol);

        // Create metadata for LST token
        const [metadataAddress] = findMetadataPda(umi, { mint: lstAddress });

        const createMetadataTx = await createTokenMetadata(umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            lstMint: lstAddress,
            metadata: metadataAddress,
            name: "Nil USD",
            uri: "http://localhost:8080/metadata",
            pair: pairAddress,
            tokenProgram: umi.programs.get('splToken').publicKey,
            sysvarInstructions: fromWeb3JsPublicKey(SYSVAR_INSTRUCTIONS_PUBKEY)
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const createMetadataResult = svm.sendTransaction(toWeb3JsTransaction(createMetadataTx));
        // console.log("Create metadata result:", createMetadataResult.toString());

        // Verify metadata was created correctly
        const metadataSerializer = getMetadataAccountDataSerializer();
        const metadataAccount = svm.getAccount(toWeb3JsPublicKey(metadataAddress));
        const [metadata] = metadataSerializer.deserialize(metadataAccount.data);

        expect(unwrapOption(metadata.tokenStandard)).to.equal(TokenStandard.Fungible);
    });

    it.skip("should fail to create metadata with unauthorized authority", async () => {
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
        const unauthorizedUser = createUser(env.svm, env.umi);

        // TODO: Attempt to create metadata with unauthorized user
        // TODO: Verify operation fails
    });

    it.skip("should update metadata", async () => {
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


        // TODO: Create metadata
        // TODO: Update metadata
        // TODO: Verify metadata was updated correctly
    });
});
