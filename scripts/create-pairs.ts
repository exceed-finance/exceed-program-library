import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { LiquidStaking, PRECISION, calculateIntervalRateFromApy, findAccessControlPda, findLstPda, findPairPda } from "../clients/js/src"
import * as fs from "fs"
import { signerIdentity, createSignerFromKeypair, none, some } from "@metaplex-foundation/umi"
import { NATIVE_MINT } from "@solana/spl-token"
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters"
import { hoursToSeconds } from "date-fns"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes"
import { createTokenMetadata } from "../clients/js/src/generated/liquid_staking"
import { findMetadataPda } from "@metaplex-foundation/mpl-token-metadata"

const createPairs = async () => {
    const umi = createUmi('REPLACE_ME');

    const adminKeypairPath = "REPLACE_ME"; // Replace with actual path
    const adminKeypairData = JSON.parse(fs.readFileSync(adminKeypairPath, "utf-8"));
    const adminKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(adminKeypairData));
    const adminSigner = createSignerFromKeypair(umi, adminKeypair);

    console.log({ adminKeypairData, adminKeypair, adminSigner })
    const [accessControlAddress] = findAccessControlPda(umi);

    const yield20Percent = 2000;
    const secondsPerInterval = hoursToSeconds(8)
    const intervalRate = calculateIntervalRateFromApy(yield20Percent, secondsPerInterval)

    umi.use(signerIdentity(adminSigner))

    const symbol = "pikSOL";
    const baseTokenMintAddress = fromWeb3JsPublicKey(NATIVE_MINT);
    const [lstMintAddress] = findLstPda(umi, symbol);
    const [pairAddress] = findPairPda(umi, baseTokenMintAddress, lstMintAddress);

    console.log({
        baseTokenMintAddress: baseTokenMintAddress.toString(),
        lstMintAddress: lstMintAddress.toString(),
        pair: pairAddress.toString(),
        pairAuthority: adminSigner.publicKey.toString()
    });

    const _tx = await LiquidStaking.createPair(umi, {
        pairAuthority: adminSigner,
        lstMint: lstMintAddress,
        accessControl: accessControlAddress,
        baseTokenMint: baseTokenMintAddress,
        symbol,
        intervalAprRate: intervalRate,
        secondsPerInterval: secondsPerInterval,
        initialExchangeRate: PRECISION,
        depositCap: 7100759781296598000n, // a billion dollars of sol at $140
        stakeFeeBps: 0,
        swapFeeBps: 0,
        withdrawFeeBps: 50,
        minimumDeposit: 3000000, // 10 of sol at $140
        pairType: 0
    }).buildWithLatestBlockhash(umi);

    // console.log(bs58.encode(createPikSolSig));

    const [metadataAddress] = findMetadataPda(umi, {
        mint: lstMintAddress,
    });

    const _tx2 = await createTokenMetadata(umi, {
        pairAuthority: adminSigner,
        pair: pairAddress,
        lstMint: lstMintAddress,
        metadata: metadataAddress,
        name: "PIK SOL",
        uri: "https://storage.googleapis.com/parity-lst-dev/JSON/pik_sol.json"
    }).buildWithLatestBlockhash(umi);

    // console.log(bs58.encode(createPikSolMetadataSig))

    const _tx3 = await LiquidStaking.updatePairLimits(umi, {
        pair: pairAddress,
        depositCap: none(),
        minimumDeposit: some(30000000),
        stakeFeeBps: none(),
        swapFeeBps: none(),
        withdrawFeeBps: none()
    }).buildWithLatestBlockhash(umi);

    // console.log(bs58.encode(updatePairLimitsSig))

    const pair = await LiquidStaking.fetchPair(umi, pairAddress);
    console.log(pair)
}

createPairs().then(() => {
    console.log("done")
})