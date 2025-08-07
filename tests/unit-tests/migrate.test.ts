
import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createMintAtAddress,
    timeTravel
} from "../helpers";
import { keypairIdentity, publicKey, signerIdentity, transactionBuilder } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { createAssociatedToken, findAssociatedTokenPda, getMintAccountDataSerializer, getTokenAccountDataSerializer, mintTokensTo } from "@metaplex-foundation/mpl-toolbox";
import { getPairAccountDataSerializer, migrate } from "../../clients/js/src/generated/liquid_staking";
import { calculateExchangeRate, calculateLstAmount } from "../../clients/js/src";
import { getUnixTime } from "date-fns";

describe("migrate", () => {
    it.only("should work with correct legacy tokens", async () => {
        const { svm, umi } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const authorityKeypair = createUser(svm, umi);

        let pairAddress = publicKey("EwqMpnBHKEd537E37kcsNU9Qi82uukjVAXsC8K5Kswt7")
        let pusdMintAddress = publicKey("9ir8o6rj7dJsXXFQPbDZcWCiPx4UDcdTKrYZfnct6GDm");
        let pikUsdcMint = publicKey("8B9vL4c9w5HiyFXdPT8Z8hgFvSeZ14Y5DxjCZyRSTf4z");

        createMintAtAddress(svm, pusdMintAddress, authorityKeypair.publicKey, 6);

        let [authorityPusdTokenAddress] = findAssociatedTokenPda(umi, {
            owner: authorityKeypair.publicKey,
            mint: pusdMintAddress
        });

        let [authorityPikUsdcTokenAddress] = findAssociatedTokenPda(umi, {
            owner: authorityKeypair.publicKey,
            mint: pikUsdcMint
        });

        const mintTx = await transactionBuilder().add(
            createAssociatedToken(umi, {
                owner: authorityKeypair.publicKey,
                mint: pusdMintAddress
            })
        )
            .add(
                mintTokensTo(umi, {
                    token: authorityPusdTokenAddress,
                    amount: 300_000_000,
                    mint: pusdMintAddress,
                    mintAuthority: authorityKeypair
                })
            ).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)


        const _mintResult = svm.sendTransaction(toWeb3JsTransaction(mintTx));

        let tokenSerializer = getTokenAccountDataSerializer();
        let accountInfo = svm.getAccount(toWeb3JsPublicKey(authorityPusdTokenAddress));

        let [tokenAccount] = tokenSerializer.deserialize(accountInfo.data);

        expect(tokenAccount.amount).to.equal(300_000_000n);


        // load pair and create pikUSDC mint
        let pairSerializer = getPairAccountDataSerializer();
        let pairInfo = svm.getAccount(toWeb3JsPublicKey(pairAddress));
        let [pair] = pairSerializer.deserialize(pairInfo.data);

        createMintAtAddress(svm, pikUsdcMint, pikUsdcMint, pair.lstMintDecimals);

        umi.use(keypairIdentity(authorityKeypair))
        let migrateTx = await migrate(umi, {
            accessControl: accessControl.accessControlAddress,
            staker: authorityKeypair,
            pair: pairAddress,
            stakerPUsdAccount: authorityPusdTokenAddress,
            stakerPikUsdcAccount: authorityPikUsdcTokenAddress,
            pikUsdcMint: pair.lstMint,
            pUsdMint: pusdMintAddress,
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        let migrateResult = svm.sendTransaction(toWeb3JsTransaction(migrateTx))
        console.log(migrateResult.toString());

        let authorityPikUsdcAccountInfo = svm.getAccount(toWeb3JsPublicKey(authorityPikUsdcTokenAddress));
        let [authorityPikUsdcAccount] = tokenSerializer.deserialize(authorityPikUsdcAccountInfo.data);

        let now = new Date();
        let nowTimestamp = getUnixTime(now);
        timeTravel(svm, now);

        let exchangeRate = calculateExchangeRate(pair.lastYieldChangeTimestamp, nowTimestamp, pair.intervalAprRate, pair.lastYieldChangeExchangeRate, pair.secondsPerInterval);
        let lstAmount = calculateLstAmount(300_000_000, exchangeRate, 6, 6);

        expect(authorityPikUsdcAccount.amount).to.equal(lstAmount);
    });

});
