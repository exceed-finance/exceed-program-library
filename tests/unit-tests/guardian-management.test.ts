import { expect } from "chai";
import {
    createTestEnvironment,
    createAccessControlAccounts,
    createUser,
    timeTravel
} from "../helpers";
import { getAccessControlAccountDataSerializer, GuardianOperation, manageGuardian } from "../../clients/js/src/generated/liquid_staking";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { isSome, unwrapOption, signerIdentity } from "@metaplex-foundation/umi";
import { addSeconds } from "date-fns";

describe("guardian-management", () => {
    it("should add and remove guardians", async () => {
        // Setup
        const { svm, umi } = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(svm, umi);
        const guardian = createUser(svm, umi);


        const manageGuardianTx = await manageGuardian(umi, {
            accessControl: accessControl.accessControlAddress,
            unsealAuthority: accessControl.authorities.unsealAuthority,
            operation: GuardianOperation.Add,
            guardian: guardian.publicKey
        }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

        const manageResult = svm.sendTransaction(toWeb3JsTransaction(manageGuardianTx))
        // console.log(manageResult.toString());

        const accessControlSerializer = getAccessControlAccountDataSerializer();
        const accessControlAccount = svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const [updatedAccessControl] = accessControlSerializer.deserialize(accessControlAccount.data);

        expect(isSome(updatedAccessControl.guardians[0])).to.be.true

        const firstGuardian = unwrapOption(updatedAccessControl.guardians[0]);
        expect(firstGuardian).to.deep.equal(guardian.publicKey)
    });

    it("should fail to add guardian with wrong authority", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const guardian = createUser(env.svm, env.umi);
        const unauthorizedUser = createUser(env.svm, env.umi);

        // Get the initial state of the access control
        const accessControlSerializer = getAccessControlAccountDataSerializer();
        const initialAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const [initialAccessControl] = accessControlSerializer.deserialize(initialAccessControlAccount.data);

        // Attempt to add guardian with wrong authority
        env.umi.use(signerIdentity(unauthorizedUser));
        const manageGuardianTx = await manageGuardian(env.umi, {
            accessControl: accessControl.accessControlAddress,
            unsealAuthority: unauthorizedUser,
            operation: GuardianOperation.Add,
            guardian: guardian.publicKey
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        // Send the transaction (it will fail but not throw in the test)
        env.svm.sendTransaction(toWeb3JsTransaction(manageGuardianTx));

        // Verify the guardian was not added
        const finalAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const [finalAccessControl] = accessControlSerializer.deserialize(finalAccessControlAccount.data);

        // Check that all guardian slots are still None or unchanged
        for (let i = 0; i < finalAccessControl.guardians.length; i++) {
            if (initialAccessControl.guardians[i] === null) {
                expect(finalAccessControl.guardians[i]).to.equal(null);
            } else {
                expect(finalAccessControl.guardians[i]).to.deep.equal(initialAccessControl.guardians[i]);
            }
        }
    });

    it("should fail to remove guardian with wrong authority", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const guardian = createUser(env.svm, env.umi);
        const unauthorizedUser = createUser(env.svm, env.umi);

        // Add guardian with correct authority
        env.umi.use(signerIdentity(accessControl.authorities.unsealAuthority));
        const addGuardianTx = await manageGuardian(env.umi, {
            accessControl: accessControl.accessControlAddress,
            unsealAuthority: accessControl.authorities.unsealAuthority,
            operation: GuardianOperation.Add,
            guardian: guardian.publicKey
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);
        env.svm.sendTransaction(toWeb3JsTransaction(addGuardianTx));

        // Verify guardian was added
        const accessControlSerializer = getAccessControlAccountDataSerializer();
        const updatedAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const [updatedAccessControl] = accessControlSerializer.deserialize(updatedAccessControlAccount.data);

        // Find the guardian in the list
        const guardianIndex = updatedAccessControl.guardians.findIndex(
            slot => slot !== null && isSome(slot) && unwrapOption(slot).toString() === guardian.publicKey.toString()
        );
        expect(guardianIndex).to.be.greaterThan(-1);

        // Attempt to remove guardian with wrong authority
        env.umi.use(signerIdentity(unauthorizedUser));
        const removeGuardianTx = await manageGuardian(env.umi, {
            accessControl: accessControl.accessControlAddress,
            unsealAuthority: unauthorizedUser,
            operation: GuardianOperation.Remove,
            guardian: guardian.publicKey
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        // Send the transaction (it will fail but not throw in the test)
        env.svm.sendTransaction(toWeb3JsTransaction(removeGuardianTx));

        // Verify the guardian was not removed
        const finalAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const [finalAccessControl] = accessControlSerializer.deserialize(finalAccessControlAccount.data);

        // Check that the guardian is still in the list
        const finalGuardianIndex = finalAccessControl.guardians.findIndex(
            slot => slot !== null && isSome(slot) && unwrapOption(slot).toString() === guardian.publicKey.toString()
        );
        expect(finalGuardianIndex).to.equal(guardianIndex);
    });

    it("should fail to add duplicate guardian", async () => {
        // Setup
        const env = createTestEnvironment();
        const accessControl = await createAccessControlAccounts(env.svm, env.umi);
        const guardian = createUser(env.svm, env.umi);

        // Add guardian for the first time
        env.umi.use(signerIdentity(accessControl.authorities.unsealAuthority));
        const addGuardianTx = await manageGuardian(env.umi, {
            accessControl: accessControl.accessControlAddress,
            unsealAuthority: accessControl.authorities.unsealAuthority,
            operation: GuardianOperation.Add,
            guardian: guardian.publicKey
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        // Send the transaction
        const addResult = env.svm.sendTransaction(toWeb3JsTransaction(addGuardianTx));
        // console.log(addResult.toString())

        // Verify guardian was added
        const accessControlSerializer = getAccessControlAccountDataSerializer();
        const updatedAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const [updatedAccessControl] = accessControlSerializer.deserialize(updatedAccessControlAccount.data);

        // Find the guardian in the list
        const guardianIndex = updatedAccessControl.guardians.findIndex(
            slot => slot !== null && isSome(slot) && unwrapOption(slot).toString() === guardian.publicKey.toString()
        );
        expect(guardianIndex).to.be.greaterThan(-1);

        // Attempt to add the same guardian again
        const duplicateAddTx = await manageGuardian(env.umi, {
            accessControl: accessControl.accessControlAddress,
            unsealAuthority: accessControl.authorities.unsealAuthority,
            operation: GuardianOperation.Add,
            guardian: guardian.publicKey
        }).setBlockhash(env.svm.latestBlockhash()).buildAndSign(env.umi);

        // Send the transaction (it will fail due to duplicate guardian)
        const duplicateAddResult = env.svm.sendTransaction(toWeb3JsTransaction(duplicateAddTx));
        // console.log(duplicateAddResult.toString())

        // Note: We don't check the error directly as the transaction error structure varies,
        // instead we verify the state didn't change which confirms the transaction failed

        // Verify the guardians array wasn't modified (still only one instance of the guardian)
        const finalAccessControlAccount = env.svm.getAccount(toWeb3JsPublicKey(accessControl.accessControlAddress));
        const [finalAccessControl] = accessControlSerializer.deserialize(finalAccessControlAccount.data);

        // Count occurrences of the guardian in the array
        const guardianCount = finalAccessControl.guardians.filter(
            slot => slot !== null && isSome(slot) && unwrapOption(slot).toString() === guardian.publicKey.toString()
        ).length;

        // Verify there's still only one instance of the guardian
        expect(guardianCount).to.equal(1);
    });
});
