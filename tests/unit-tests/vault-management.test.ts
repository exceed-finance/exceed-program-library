import { expect } from "chai";
import { addDays, addHours, addSeconds, fromUnixTime, getUnixTime } from "date-fns";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    createTestMint,
    createPairAccounts,
    getTokenAccountData,
    timeTravel
} from "../helpers";
import {
    createAssociatedToken,
    findAssociatedTokenPda,
    getMintAccountDataSerializer,
    mintTokensTo,
    setComputeUnitLimit
} from "@metaplex-foundation/mpl-toolbox";
import { none, signerIdentity, some, transactionBuilder } from "@metaplex-foundation/umi";
import {
    createWithdrawalWindow,
    executeWithdraw,
    fundWithdrawalWindow,
    getWithdrawalWindowAccountDataSerializer,
    requestWithdraw,
    stake,
    vaultWithdraw,
    withdrawFees
} from "../../clients/js/src/generated/liquid_staking";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { findWithdrawalWindowPda } from "../../clients/js";

describe("vault-management", () => {
    it("should withdraw from vault with correct authority", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            withdrawFeeBps: 100 // 1% fee
        });

        // Create and fund token accounts
        const [authorityBaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: accessControl.authorities.vaultAuthority.publicKey
        });

        // Mint tokens to the pair's base token account
        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: accessControl.authorities.vaultAuthority.publicKey,
                    mint: baseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: pair.baseTokenAddress,
                    amount: 1_000_000_000n,
                    mint: baseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Get initial balances
        const pairBalanceBefore = getTokenAccountData(env.svm, pair.baseTokenAddress).amount;
        const authorityBalanceBefore = getTokenAccountData(env.svm, authorityBaseTokenAddress).amount;

        // Amount to withdraw
        const withdrawAmount = 500_000_000n;

        // Withdraw from vault with correct authority
        env.umi.use(signerIdentity(accessControl.authorities.vaultAuthority));
        const withdrawTx = await vaultWithdraw(env.umi, {
            pair: pair.pairAddress,
            authority: accessControl.authorities.vaultAuthority,
            accessControl: accessControl.accessControlAddress,
            pairBaseTokenAccount: pair.baseTokenAddress,
            authorityTokenAccount: authorityBaseTokenAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            amount: withdrawAmount
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(withdrawTx));

        // Get final balances
        const pairBalanceAfter = getTokenAccountData(env.svm, pair.baseTokenAddress).amount;
        const authorityBalanceAfter = getTokenAccountData(env.svm, authorityBaseTokenAddress).amount;

        // Verify balances
        expect(pairBalanceAfter).to.equal(pairBalanceBefore - withdrawAmount);
        expect(authorityBalanceAfter).to.equal(authorityBalanceBefore + withdrawAmount);
    });

    it("should fail to withdraw from vault with wrong authority", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
            withdrawFeeBps: 100 // 1% fee
        });

        // Create unauthorized user
        const unauthorizedUser = createUser(env.svm, env.umi);

        // Create and fund token accounts
        const [unauthorizedUserBaseTokenAddress] = findAssociatedTokenPda(env.umi, {
            mint: baseMint.mintKeypair.publicKey,
            owner: unauthorizedUser.publicKey
        });

        // Mint tokens to the pair's base token account
        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: unauthorizedUser.publicKey,
                    mint: baseMint.mintKeypair.publicKey
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: pair.baseTokenAddress,
                    amount: 1_000_000_000n,
                    mint: baseMint.mintKeypair.publicKey,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(mintTx));

        // Get initial balances
        const pairBalanceBefore = getTokenAccountData(env.svm, pair.baseTokenAddress).amount;
        const unauthorizedUserBalanceBefore = getTokenAccountData(env.svm, unauthorizedUserBaseTokenAddress).amount;

        // Amount to withdraw
        const withdrawAmount = 500_000_000n;

        // Attempt to withdraw from vault with wrong authority
        env.umi.use(signerIdentity(unauthorizedUser));
        const withdrawTx = await vaultWithdraw(env.umi, {
            pair: pair.pairAddress,
            authority: unauthorizedUser,
            accessControl: accessControl.accessControlAddress,
            pairBaseTokenAccount: pair.baseTokenAddress,
            authorityTokenAccount: unauthorizedUserBaseTokenAddress,
            baseTokenMint: baseMint.mintKeypair.publicKey,
            amount: withdrawAmount
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(withdrawTx));

        // Get final balances
        const pairBalanceAfter = getTokenAccountData(env.svm, pair.baseTokenAddress).amount;
        const unauthorizedUserBalanceAfter = getTokenAccountData(env.svm, unauthorizedUserBaseTokenAddress).amount;

        // Verify balances remain unchanged
        expect(pairBalanceAfter).to.equal(pairBalanceBefore);
        expect(unauthorizedUserBalanceAfter).to.equal(unauthorizedUserBalanceBefore);
    });

    it("should withdraw LST fees", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const mintAuthority = createUser(env.svm, env.umi);
        const baseMint = await createTestMint(env.svm, env.umi, mintAuthority);
        const pair = await createPairAccounts(env.svm, env.umi, {
            pairAuthority: accessControl.authorities.pairAuthority,
            accessControlAddress: accessControl.accessControlAddress,
            baseMint: baseMint.mintKeypair.publicKey,
            symbol: "NILUSD",
        });

        // Create vault authority LST token account
        const [vaultAuthorityLstAddress] = findAssociatedTokenPda(env.umi, {
            owner: accessControl.authorities.vaultAuthority.publicKey,
            mint: pair.lstAddress
        });

        const lstMintAccount = env.svm.getAccount(toWeb3JsPublicKey(pair.lstAddress));
        const mintSerializer = getMintAccountDataSerializer()
        const [lstMint] = mintSerializer.deserialize(lstMintAccount.data);

        // set the mint authority to the test mint authority so we can mint
        // tokens directly to the fee account without going through the entire flow.
        env.svm.setAccount(toWeb3JsPublicKey(pair.lstAddress), {
            ...lstMintAccount,
            data: mintSerializer.serialize({
                ...lstMint,
                mintAuthority: some(mintAuthority.publicKey)
            })
        })


        // Create token accounts and mint LST tokens directly to the fee account
        const feeAmount = 50_000_000n;
        env.umi.use(signerIdentity(mintAuthority))
        const mintTx = await transactionBuilder()
            .add(
                createAssociatedToken(env.umi, {
                    owner: accessControl.authorities.vaultAuthority.publicKey,
                    mint: pair.lstAddress
                })
            )
            .add(
                mintTokensTo(env.umi, {
                    token: pair.lstTokenAddress,
                    amount: feeAmount,
                    mint: pair.lstAddress,
                    mintAuthority: mintAuthority
                })
            )
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        const mintResult = env.svm.sendTransaction(toWeb3JsTransaction(mintTx));
        // console.log(mintResult.toString())

        // Get initial balances
        const feeAccountBalanceBefore = getTokenAccountData(env.svm, pair.lstTokenAddress).amount;
        const vaultAuthorityBalanceBefore = getTokenAccountData(env.svm, vaultAuthorityLstAddress).amount;

        // Verify fee account has the minted tokens
        expect(Number(feeAccountBalanceBefore)).to.equal(Number(feeAmount));
        expect(Number(vaultAuthorityBalanceBefore)).to.equal(0);

        // Withdraw fees
        env.umi.use(signerIdentity(accessControl.authorities.vaultAuthority));
        const withdrawFeesTx = await withdrawFees(env.umi, {
            accessControl: accessControl.accessControlAddress,
            pair: pair.pairAddress,
            lstMint: pair.lstAddress,
            feeAccount: pair.lstTokenAddress,
            destination: vaultAuthorityLstAddress,
            destinationOwner: accessControl.authorities.vaultAuthority.publicKey,
            vaultAuthority: accessControl.authorities.vaultAuthority,
            amount: feeAmount,
        })
            .setBlockhash(env.svm.latestBlockhash())
            .buildAndSign(env.umi);

        env.svm.sendTransaction(toWeb3JsTransaction(withdrawFeesTx));

        // Get final balances
        const feeAccountBalanceAfter = getTokenAccountData(env.svm, pair.lstTokenAddress).amount;
        const vaultAuthorityBalanceAfter = getTokenAccountData(env.svm, vaultAuthorityLstAddress).amount;

        // Verify balances after fee withdrawal
        expect(Number(feeAccountBalanceAfter)).to.equal(0);
        expect(Number(vaultAuthorityBalanceAfter)).to.equal(Number(feeAmount));
    });
});
