import { createSignerFromKeypair, generateSigner, signerIdentity } from "@metaplex-foundation/umi";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createAccessControl, getAccessControlAccountDataSerializer } from "../../clients/js/src/generated/liquid_staking";
import { findAccessControlPda } from "../../clients/js";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import * as fs from "fs";
import { LiteSVM } from "litesvm";

/**
 * Loads a keypair from a file
 */
export const loadKeypairBytes = (filename: string): Uint8Array => {
    return Uint8Array.from(JSON.parse(fs.readFileSync(`test-keypairs/${filename}`, "utf-8")));
};

/**
 * Creates access control accounts and returns relevant data
 */
export async function createAccessControlAccounts(svm: LiteSVM, umi: any) {
    const accessControlCreatorKeypair = umi.eddsa.createKeypairFromSecretKey(
        loadKeypairBytes("access-control-creator.json")
    );
    const accessControlCreatorSigner = createSignerFromKeypair(umi, accessControlCreatorKeypair);

    svm.airdrop(toWeb3JsPublicKey(accessControlCreatorKeypair.publicKey), BigInt(LAMPORTS_PER_SOL));

    const vaultAuthority = createUser(svm, umi);
    const windowAuthority = createUser(svm, umi);
    const depositAuthority = createUser(svm, umi);
    const pairAuthority = createUser(svm, umi);
    const unsealAuthority = createUser(svm, umi);
    const accessAuthority = createUser(svm, umi)
    const navAuthority = createUser(svm, umi)

    const [accessControlAddress] = findAccessControlPda(umi);

    umi.use(signerIdentity(accessControlCreatorSigner));
    const createAccessControlTx = await createAccessControl(umi, {
        accessControl: accessControlAddress,
        admin: accessControlCreatorSigner,
        vaultAuthority: vaultAuthority.publicKey,
        windowAuthority: windowAuthority.publicKey,
        depositAuthority: depositAuthority.publicKey,
        pairAuthority: pairAuthority.publicKey,
        unsealAuthority: unsealAuthority.publicKey,
        accessAuthority: accessAuthority.publicKey,
        navAuthority: navAuthority.publicKey
    }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

    const result = svm.sendTransaction(toWeb3JsTransaction(createAccessControlTx));
    // console.log(result.toString());

    const accessControlAccount = svm.getAccount(toWeb3JsPublicKey(accessControlAddress));
    const accessControlSerializer = getAccessControlAccountDataSerializer();
    const [accessControl] = accessControlSerializer.deserialize(accessControlAccount.data);

    return {
        accessControlAddress,
        accessControl,
        authorities: {
            vaultAuthority,
            windowAuthority,
            depositAuthority,
            pairAuthority,
            unsealAuthority,
            accessAuthority,
            navAuthority,
            accessControlCreator: accessControlCreatorSigner
        }
    };
}

/**
 * Creates a user with SOL and returns the signer
 */
export function createUser(svm: LiteSVM, umi: any, lamports = LAMPORTS_PER_SOL) {
    const user = generateSigner(umi);
    svm.airdrop(toWeb3JsPublicKey(user.publicKey), BigInt(lamports));
    return user;
}
