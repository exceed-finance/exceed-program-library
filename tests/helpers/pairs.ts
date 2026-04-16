import { signerIdentity, Signer, PublicKey } from "@metaplex-foundation/umi";
import { createPair, getPairAccountDataSerializer } from "../../clients/js/src/generated/liquid_staking";
import { findLstPda, findPairPda } from "../../clients/js/src";
import { fromWeb3JsPublicKey, toWeb3JsPublicKey, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import { PRECISION } from "../../clients/js/src";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Creates a pair and returns relevant data
 */
export async function createPairAccounts(svm: LiteSVM, umi: any, params: {
    pairAuthority: Signer;
    accessControlAddress: PublicKey;
    baseMint: PublicKey;
    tokenProgramId?: PublicKey,
    symbol: string;
    intervalAprRate?: bigint;
    secondsPerInterval?: number;
    initialExchangeRate?: number;
    depositCap?: bigint;
    minimumDeposit?: bigint;
    stakeFeeBps?: number;
    swapFeeBps?: number;
    withdrawFeeBps?: number;
}) {
    const {
        pairAuthority,
        accessControlAddress,
        baseMint,
        symbol,
        intervalAprRate = 1000044558220n, // 5% APY with 8-hour intervals
        secondsPerInterval = 8 * 60 * 60, // 8 hours in seconds
        initialExchangeRate = PRECISION,
        depositCap = 1_000_000_000n,
        minimumDeposit = 100_000n,
        stakeFeeBps = 0,
        swapFeeBps = 0,
        withdrawFeeBps = 100,
    } = params;

    let tokenProgramId = params.tokenProgramId || fromWeb3JsPublicKey(TOKEN_PROGRAM_ID)

    let [lstAddress, lstBump] = findLstPda(umi, symbol);
    let [pairAddress, pairBump] = findPairPda(umi, baseMint, lstAddress);
    let [lstTokenAddress] = findAssociatedTokenPda(umi, {
        mint: lstAddress,
        owner: pairAddress,
        tokenProgramId,
    })
    let [baseTokenAddress] = findAssociatedTokenPda(umi, {
        mint: baseMint,
        owner: pairAddress,
        tokenProgramId,
    })

    umi.use(signerIdentity(pairAuthority));
    svm.airdrop(toWeb3JsPublicKey(pairAuthority.publicKey), BigInt(LAMPORTS_PER_SOL));

    const createPairTx = await createPair(umi, {
        pair: pairAddress,
        lstMint: lstAddress,
        pairAuthority,
        accessControl: accessControlAddress,
        baseTokenMint: baseMint,
        symbol,
        intervalAprRate,
        secondsPerInterval,
        initialExchangeRate,
        depositCap,
        minimumDeposit,
        stakeFeeBps,
        swapFeeBps,
        withdrawFeeBps,
        pairType: 0,
        tokenProgram: tokenProgramId,
        pairBaseTokenAccount: baseTokenAddress,
        lstFeeAccount: lstTokenAddress
    }).setBlockhash(svm.latestBlockhash()).buildAndSign(umi);

    const _result = svm.sendTransaction(toWeb3JsTransaction(createPairTx));
    // console.log(_result.toString())

    const pairSerializer = getPairAccountDataSerializer();
    const pairAccount = svm.getAccount(toWeb3JsPublicKey(pairAddress));
    const [pair] = pairSerializer.deserialize(pairAccount.data);

    return { pairAddress, pair, lstAddress, lstTokenAddress, baseTokenAddress };
}
