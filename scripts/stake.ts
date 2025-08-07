
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { LiquidStaking, PRECISION, calculateIntervalRateFromApy, findAccessControlPda, findLstPda, findPairPda } from "../clients/js/src"
import * as fs from "fs"
import { signerIdentity, createSignerFromKeypair, none } from "@metaplex-foundation/umi"
import { NATIVE_MINT } from "@solana/spl-token"
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters"
import { hoursToSeconds } from "date-fns"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes"
import { createLiquidStakingProgram, createTokenMetadata } from "../clients/js/src/generated/liquid_staking"
import { findMetadataPda } from "@metaplex-foundation/mpl-token-metadata"
import { createSplTokenProgram, createSplAssociatedTokenProgram, findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox"

const executeStake = async () => {
    const umi = createUmi('REPLACE_ME');
    umi.programs.add(createSplAssociatedTokenProgram());
    umi.programs.add(createSplTokenProgram());
    umi.programs.add(createLiquidStakingProgram());

    const adminKeypairPath = "/mnt/nugget/keys/nil/n1.json"; // Replace with actual path
    const adminKeypairData = JSON.parse(fs.readFileSync(adminKeypairPath, "utf-8"));
    const adminKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(adminKeypairData));
    const adminSigner = createSignerFromKeypair(umi, adminKeypair);

    // console.log({ adminKeypairData, adminKeypair, adminSigner })
    const [accessControlAddress] = findAccessControlPda(umi);

    const yield20Percent = 2000;
    const secondsPerInterval = hoursToSeconds(8)
    const intervalRate = calculateIntervalRateFromApy(yield20Percent, secondsPerInterval)

    umi.use(signerIdentity(adminSigner))

    const symbol = "pikSOL";
    const baseTokenMintAddress = fromWeb3JsPublicKey(NATIVE_MINT);
    const [lstMintAddress] = findLstPda(umi, symbol);
    const [pairAddress] = findPairPda(umi, baseTokenMintAddress, lstMintAddress);

    const [lstFeeAddress] = findAssociatedTokenPda(umi, {
        mint: lstMintAddress,
        owner: pairAddress
    });



    const [stakerWsolAddress] = findAssociatedTokenPda(umi, {
        mint: baseTokenMintAddress,
        owner: adminKeypair.publicKey
    });


    console.log({
        baseTokenMintAddress: baseTokenMintAddress.toString(),
        lstMintAddress: lstMintAddress.toString(),
        pair: pairAddress.toString(),
        pairAuthority: adminSigner.publicKey.toString(),
        stakerWsol: stakerWsolAddress.toString(),
        lstFeeAddress: lstFeeAddress.toString(),
    });
    // 6yAAsAaaodiTvv9FiJyqxv8NNnaR3PYTLEEtfLdujHyr
    const { signature: stakeSig } = await LiquidStaking.stake(umi, {
        accessControl: accessControlAddress,
        pair: pairAddress,
        baseTokenMint: baseTokenMintAddress,
        lstFeeAccount: lstFeeAddress,
        lstMint: lstMintAddress,
        staker: adminSigner,
        quantity: 30_000_100n,
        merkleProof: none()
    }).sendAndConfirm(umi);

    console.log(bs58.encode(stakeSig))

}

executeStake().then(() => {
    console.log("done");
})