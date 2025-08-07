import { Umi, generateSigner, PublicKey, signerIdentity, transactionBuilder, Signer } from "@metaplex-foundation/umi";
import { createMint, createAssociatedToken, mintTokensToChecked, getMintAccountDataSerializer, getTokenAccountDataSerializer, findAssociatedTokenPda, TokenAccountData, MintAccountData, createToken } from "@metaplex-foundation/mpl-toolbox";
import { toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { LiteSVM } from "litesvm";

/**
 * Creates a mint and returns relevant data
 */
export async function createTestMint(svm: LiteSVM, umi: Umi, mintAuthority: Signer, decimals: number = 0) {
    const mintKeypair = generateSigner(umi);

    umi.use(signerIdentity(mintAuthority));
    const createMintTx = await createMint(umi, {
        mint: mintKeypair,
        mintAuthority: mintAuthority.publicKey,
        decimals
    }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

    svm.sendTransaction(toWeb3JsTransaction(createMintTx));

    const mintSerializer = getMintAccountDataSerializer();
    const mintAccount = svm.getAccount(toWeb3JsPublicKey(mintKeypair.publicKey));
    const [mint] = mintSerializer.deserialize(mintAccount.data);

    return { mintKeypair, mint };
}

/**
 * Gets token account data
 */
export function getTokenAccountData(svm: LiteSVM, tokenAddress: PublicKey): TokenAccountData | null {
    const tokenAccountSerializer = getTokenAccountDataSerializer();
    const tokenAccount = svm.getAccount(toWeb3JsPublicKey(tokenAddress));
    if (!tokenAccount) {
        return null;
    }
    const [tokenData] = tokenAccountSerializer.deserialize(tokenAccount.data);
    return tokenData;
}

export function getMintData(svm: LiteSVM, mintAddress: PublicKey): MintAccountData | null {
    const mintSerializer = getMintAccountDataSerializer();
    const mintAccount = svm.getAccount(toWeb3JsPublicKey(mintAddress));

    if (!mintAccount) {
        return null
    }

    const [mintData] = mintSerializer.deserialize(mintAccount.data)
    return mintData;
}
