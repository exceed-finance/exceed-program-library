import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser
} from "../helpers";
import { acceptAuthorityTransfer, AuthorityType, cancelAuthorityTransfer, fetchAccessControl, getAccessControlAccountDataSerializer, initiateAuthorityTransfer } from "../../clients/js/src/generated/liquid_staking";
import { signerIdentity } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { isSome, unwrapOption } from "@metaplex-foundation/umi";

describe("authority-transfer", () => {
    it("should initiate, accept, and complete authority transfer", async () => {
        // Setup
        const { svm, umi } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const newDepositAuthority = createUser(svm, umi);

        // Initiate authority transfer
        umi.use(signerIdentity(accessControl.authorities.depositAuthority))
        const authorityTransferTx = await initiateAuthorityTransfer(umi, {
            authorityType: AuthorityType.Deposit,
            currentAuthority: accessControl.authorities.depositAuthority,
            newAuthority: newDepositAuthority.publicKey,
            accessControl: accessControl.accessControlAddress
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const transferResult = svm.sendTransaction(toWeb3JsTransaction(authorityTransferTx));

        // get access control, it should show a pending authority
        let accessControlSerializer = getAccessControlAccountDataSerializer()
        let accessControlAccount = svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress))
        let [accessControlState1] = accessControlSerializer.deserialize(accessControlAccount.data);

        expect(isSome(accessControlState1.pendingDepositAuthority)).to.equal(true, "should be an pending authority")

        const acceptAuthorityTransferTx = await acceptAuthorityTransfer(umi, {
            accessControl: accessControl.accessControlAddress,
            authorityType: AuthorityType.Deposit,
            newAuthority: newDepositAuthority
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);
        const acceptResult = svm.sendTransaction(toWeb3JsTransaction(acceptAuthorityTransferTx));
        accessControlAccount = svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress))
        let [accessControlState2] = accessControlSerializer.deserialize(accessControlAccount.data);

        expect(isSome(accessControlState2.pendingDepositAuthority)).to.equal(false, "should not have a pending authority");
        expect(accessControlState2.depositAuthority).to.equal(newDepositAuthority.publicKey, "should update authority public key");

    });

    it("should allow cancelling authority transfer", async () => {
        // Setup
        const { svm, umi } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const newVaultAuthority = createUser(svm, umi);

        // Initiate authority transfer
        umi.use(signerIdentity(accessControl.authorities.depositAuthority))
        const authorityTransferTx = await initiateAuthorityTransfer(umi, {
            authorityType: AuthorityType.Vault,
            currentAuthority: accessControl.authorities.vaultAuthority,
            newAuthority: newVaultAuthority.publicKey,
            accessControl: accessControl.accessControlAddress
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi)
        const transferResult = svm.sendTransaction(toWeb3JsTransaction(authorityTransferTx));

        // get access control, it should show a pending authority
        let accessControlSerializer = getAccessControlAccountDataSerializer()
        let accessControlAccount = svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress))
        let [accessControlState1] = accessControlSerializer.deserialize(accessControlAccount.data);

        expect(isSome(accessControlState1.pendingVaultAuthority)).to.equal(true, "should be an pending authority")

        const cancelTx = await cancelAuthorityTransfer(umi, {
            accessControl: accessControl.accessControlAddress,
            currentAuthority: accessControl.authorities.vaultAuthority,
            authorityType: AuthorityType.Vault
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);
        const cancelResult = svm.sendTransaction(toWeb3JsTransaction(cancelTx))

        accessControlAccount = svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress))
        let [accessControlState2] = accessControlSerializer.deserialize(accessControlAccount.data);

        expect(isSome(accessControlState2.pendingVaultAuthority)).to.equal(false, "should not have a pending authority");
        expect(accessControlState2.vaultAuthority).to.equal(accessControl.authorities.vaultAuthority.publicKey, "should have the same authority")
    });

    it.skip("should only transfer with the correct authority", async () => { });
    it.skip("should only cancel with the correct authority", async () => { });
});
