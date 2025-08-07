import { AccountInfoBytes, LiteSVM } from "litesvm";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { none, PublicKey, publicKey } from "@metaplex-foundation/umi";
import { createLiquidStakingProgram, LIQUID_STAKING_PROGRAM_ID } from "../../clients/js/src/generated/liquid_staking";
import { createSplTokenProgram, createSplAssociatedTokenProgram, MPL_SYSTEM_EXTRAS_PROGRAM_ID, createSplComputeBudgetProgram, Mint, SPL_TOKEN_PROGRAM_ID, getMintAccountDataSerializer } from "@metaplex-foundation/mpl-toolbox";
import { fromUnixTime, getUnixTime, subSeconds } from "date-fns";
import { toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import { NATIVE_MINT } from "@solana/spl-token";
import * as fs from "fs";
import { AccountInfo } from "@solana/web3.js";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { createEarlyPurchaseProgram, EARLY_PURCHASE_PROGRAM_ID, } from "../../clients/js/src/generated/early_purchase";
import { getPriceUpdateV2AccountDataSerializer, PriceUpdateV2AccountData } from "../../clients/js/src/utils/priceUpdateV2/priceUpdateV2"
import { some } from "@metaplex-foundation/umi";

export const SOL_USD_FEED_ADDRESS = publicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE')
/**
 * Creates a basic test environment with SVM and UMI
 */
export function createTestEnvironment() {
    const svm = new LiteSVM().withSplPrograms();
    svm.addProgramFromFile(toWeb3JsPublicKey(LIQUID_STAKING_PROGRAM_ID), 'target/deploy/liquid_staking.so');
    svm.addProgramFromFile(toWeb3JsPublicKey(EARLY_PURCHASE_PROGRAM_ID), 'target/deploy/early_purchase.so');
    svm.addProgramFromFile(toWeb3JsPublicKey(MPL_SYSTEM_EXTRAS_PROGRAM_ID), 'program-bytes/mpl-system-extras.so');
    svm.addProgramFromFile(toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID), 'program-bytes/mpl-token-metadata.so');

    let splNativeMintBytes = fs.readFileSync('program-bytes/spl-native-mint.bin');
    let nativeMintAccountInfo = {
        executable: false,
        owner: toWeb3JsPublicKey(SPL_TOKEN_PROGRAM_ID),
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(splNativeMintBytes.length))),
        data: Uint8Array.from(splNativeMintBytes),
    } as AccountInfoBytes;
    svm.setAccount(NATIVE_MINT, nativeMintAccountInfo);

    let solUsdFeedBytes = fs.readFileSync('program-bytes/sol-usd-feed.bin');
    let solUsdPriceFeedAccountInfo = {
        executable: false,
        owner: toWeb3JsPublicKey(publicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ')),
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(solUsdFeedBytes.length))),
        data: Uint8Array.from(solUsdFeedBytes)
    } as AccountInfoBytes
    svm.setAccount(toWeb3JsPublicKey(SOL_USD_FEED_ADDRESS), solUsdPriceFeedAccountInfo)
    let pairAddress = publicKey("EwqMpnBHKEd537E37kcsNU9Qi82uukjVAXsC8K5Kswt7")
    let pikUsdcPairBytes = fs.readFileSync('program-bytes/pikusdc-pair.bin');
    let pikUsdcPairAccountInfo = {
        executable: false,
        owner: toWeb3JsPublicKey(publicKey("par1tyqusak2f2DXg9RHv78SVHNWXkJLSbtJZQSuWjV")),
        lamports: Number(svm.minimumBalanceForRentExemption(160n)),
        data: Uint8Array.from(pikUsdcPairBytes)
    } as AccountInfoBytes
    svm.setAccount(toWeb3JsPublicKey(pairAddress), pikUsdcPairAccountInfo);


    const now = new Date();
    let clock = svm.getClock();
    clock.unixTimestamp = BigInt(getUnixTime(now));
    svm.setClock(clock);

    const umi = createUmi("http://127.0.0.1:8899");
    umi.programs.add(createLiquidStakingProgram());
    umi.programs.add(createEarlyPurchaseProgram())
    umi.programs.add(createSplTokenProgram());
    umi.programs.add(createSplAssociatedTokenProgram());
    umi.programs.add(createSplComputeBudgetProgram())

    return { svm, umi, currentTime: now };
}

/**
 * Time travel helper to move the SVM clock forward
 */
export function timeTravel(svm: LiteSVM, newTime: Date): Date {
    const clock = svm.getClock();
    clock.unixTimestamp = BigInt(getUnixTime(newTime));
    svm.setClock(clock);
    return newTime;
}


export function setPriceFeedTime(svm: LiteSVM, secondsAgo: number): void {

    // // Set up the price feed data
    const priceUpdateSerializer = getPriceUpdateV2AccountDataSerializer();
    const feedAccount = svm.getAccount(toWeb3JsPublicKey(SOL_USD_FEED_ADDRESS));
    const [priceUpdate] = priceUpdateSerializer.deserialize(feedAccount.data);

    const clock = svm.getClock();

    const now = fromUnixTime(Number(clock.unixTimestamp));
    const pricePublishTime = subSeconds(now, secondsAgo);
    const modifiedPriceUpdate: PriceUpdateV2AccountData = {
        ...priceUpdate,
        priceMessage: {
            ...priceUpdate.priceMessage,
            publishTime: BigInt(getUnixTime(pricePublishTime)),
            prevPublishTime: BigInt(getUnixTime(pricePublishTime)),
        },
        postedSlot: 0n
    }

    // // Update the price feed data
    svm.setAccount(toWeb3JsPublicKey(SOL_USD_FEED_ADDRESS), {
        ...feedAccount,
        data: priceUpdateSerializer.serialize(modifiedPriceUpdate)
    })
}

export function createMintAtAddress(svm: LiteSVM, mintAddress: PublicKey, mintAuthority: PublicKey, decimals: number) {
    let mintSerializer = getMintAccountDataSerializer();
    let mintBytes = mintSerializer.serialize({
        mintAuthority: some(mintAuthority),
        supply: 0,
        decimals,
        isInitialized: true,
        freezeAuthority: none(),
    });

    let accountInfo = {
        executable: false,
        owner: toWeb3JsPublicKey(SPL_TOKEN_PROGRAM_ID),
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(mintBytes.length))),
        data: Uint8Array.from(mintBytes),
    } as AccountInfoBytes;

    svm.setAccount(toWeb3JsPublicKey(mintAddress), accountInfo);
};