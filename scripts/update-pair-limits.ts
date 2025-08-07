
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { LiquidStaking, PRECISION, calculateIntervalRateFromApy, findAccessControlPda, findLstPda, findPairPda } from "../clients/js/src"
import * as fs from "fs"
import { signerIdentity, createSignerFromKeypair, none, some, publicKey } from "@metaplex-foundation/umi"
import { NATIVE_MINT } from "@solana/spl-token"
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters"
import { hoursToSeconds } from "date-fns"
import { findMetadataPda } from "@metaplex-foundation/mpl-token-metadata"
import { base58 } from "@metaplex-foundation/umi/serializers"

const createPairs = async () => {
    const umi = createUmi('https://mainnet.helius-rpc.com/?api-key=6aa6d9fa-ff25-4d09-9a3d-715d4fcd90d3');

    const adminKeypairPath = "/mnt/nugget/keys/nil/n1.json"; // Replace with actual path
    const adminKeypairData = JSON.parse(fs.readFileSync(adminKeypairPath, "utf-8"));
    const adminKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(adminKeypairData));
    const adminSigner = createSignerFromKeypair(umi, adminKeypair);

    console.log({ adminKeypairData, adminKeypair, adminSigner })

    umi.use(signerIdentity(adminSigner))

    const pikSOL = "pikSOL";
    const pair1BaseTokenMintAddress = fromWeb3JsPublicKey(NATIVE_MINT);
    const [pair1LstMintAddress] = findLstPda(umi, pikSOL);
    const [pair1Address] = findPairPda(umi, pair1BaseTokenMintAddress, pair1LstMintAddress);

    const { signature: updatePair1Signature } = await LiquidStaking.updatePairLimits(umi, {
        pair: pair1Address,
        depositCap: 1_000_000_000_000_000_000n,
        minimumDeposit: 1000,
        stakeFeeBps: 0,
        swapFeeBps: 0,
        withdrawFeeBps: 20
    }).sendAndConfirm(umi);

    const [pair1SigString] = base58.deserialize(updatePair1Signature);
    console.log(pair1SigString)


    const pikUSDC = "pikUSDC";
    const usdcAddress = publicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    const pair2BaseTokenMintAddress = usdcAddress;
    const [pair2LstMintAddress] = findLstPda(umi, pikUSDC);
    const [pair2Address] = findPairPda(umi, pair2BaseTokenMintAddress, pair2LstMintAddress);

    const { signature: updatePair2Signature } = await LiquidStaking.updatePairLimits(umi, {
        pair: pair2Address,
        depositCap: 1_000_000_000_000_000_000n,
        minimumDeposit: 100,
        stakeFeeBps: 0,
        swapFeeBps: 0,
        withdrawFeeBps: 20
    }).sendAndConfirm(umi);

    const [pair2SigString] = base58.deserialize(updatePair2Signature);
    console.log(pair2SigString)
}

createPairs().then(() => {
    console.log("done")
})