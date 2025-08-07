import {
  KeypairSigner,
  Pda,
  PublicKey,
  Umi,
  createSignerFromKeypair,
  generateSigner,
  signerIdentity,
} from "@metaplex-foundation/umi";
import {
  publicKey as publicKeySerializer,
  string,
} from "@metaplex-foundation/umi/serializers";
import { createUser } from "./accounts";
import { LiteSVM } from "litesvm";
import {
  toWeb3JsPublicKey,
  toWeb3JsTransaction,
} from "@metaplex-foundation/umi-web3js-adapters";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PriceUpdateV2AccountData } from "../../clients/js/src/generated/early_purchase/accounts";
import { PriceFeedMessage } from "../../clients/js/src/generated/early_purchase/types";
import {
  initializeConfig,
  initializeGuardian,
  initializeSale,
  updateGuardian,
  updateSale,
  endSale,
  purchaseTokens,
  depositTokens,
  getConfigAccountDataSerializer,
  getGuardianAccountDataSerializer,
  getSaleAccountDataSerializer,
  getReceiptAccountDataSerializer,
  EARLY_PURCHASE_PROGRAM_ID,
} from "../../clients/js/src/generated/early_purchase";
import * as fs from "fs";

/**
 * Find the PDA for a config account
 */
export const findConfigPda = (umi: Umi): Pda => {
  return umi.eddsa.findPda(EARLY_PURCHASE_PROGRAM_ID, [
    string({ size: "variable" }).serialize("config"),
  ]);
};

/**
 * Find the PDA for a guardian account
 */
export const findGuardianPda = (umi: Umi, authority: PublicKey): Pda => {
  return umi.eddsa.findPda(EARLY_PURCHASE_PROGRAM_ID, [
    string({ size: "variable" }).serialize("guardian"),
    publicKeySerializer().serialize(authority),
  ]);
};

/**
 * Find the PDA for a sale account
 */
export const findSalePda = (umi: Umi, id: number | bigint): Pda => {
  const idBuffer = new Uint8Array(8);
  const view = new DataView(idBuffer.buffer);
  view.setBigUint64(0, BigInt(id), true); // true for little-endian

  return umi.eddsa.findPda(EARLY_PURCHASE_PROGRAM_ID, [
    string({ size: "variable" }).serialize("sale"),
    idBuffer,
  ]);
};

/**
 * Find the PDA for a receipt account
 */
export const findReceiptPda = (
  umi: Umi,
  buyer: PublicKey,
  sale: PublicKey
): Pda => {
  return umi.eddsa.findPda(EARLY_PURCHASE_PROGRAM_ID, [
    string({ size: "variable" }).serialize("receipt"),
    publicKeySerializer().serialize(buyer),
    publicKeySerializer().serialize(sale),
  ]);
};

/**
 * Creates config account and returns relevant data
 */
export async function createConfigAccount(
  svm: LiteSVM,
  umi: Umi,
  useRandomAdmin: boolean = false
) {
  let admin: KeypairSigner;
  if (useRandomAdmin) {
    admin = createUser(svm, umi);
  } else {
    const adminKeypairPath = "./test-keypairs/admin.json"; // Replace with actual path
    const adminKeypairData = JSON.parse(
      fs.readFileSync(adminKeypairPath, "utf-8")
    );
    const adminKeypair = umi.eddsa.createKeypairFromSecretKey(
      Uint8Array.from(adminKeypairData)
    );
    admin = createSignerFromKeypair(umi, adminKeypair);
    svm.airdrop(toWeb3JsPublicKey(admin.publicKey), BigInt(LAMPORTS_PER_SOL));
  }

  // Find config PDA
  const [configAddress] = findConfigPda(umi);

  // Initialize config
  umi.use(signerIdentity(admin));

  // console.log("Initializing config with params:", {
  //     config: configAddress.toString(),
  //     admin: admin.publicKey.toString()
  // });

  const initializeConfigTx = await initializeConfig(umi, {
    config: configAddress,
    admin: admin,
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(initializeConfigTx));
  // console.log("Initialize Config Transaction Result:", result.toString());

  // Get config data - add error handling
  const configAccount = svm.getAccount(toWeb3JsPublicKey(configAddress));
  // console.log("Config account exists:", configAccount !== null);

  if (!configAccount) {
    throw new Error("Config account not found");
  }

  // console.log("Config account data:", configAccount.data);
  // console.log("Config account data length:", configAccount.data.length);

  const configSerializer = getConfigAccountDataSerializer();
  // console.log("Config serializer:", configSerializer);

  const [config] = configSerializer.deserialize(configAccount.data);
  // console.log("Config deserialized successfully:", config);

  return {
    configAddress,
    config,
    admin,
  };
}

/**
 * Creates guardian account and returns relevant data
 */
export async function createGuardianAccount(
  svm: LiteSVM,
  umi: Umi,
  admin: any,
  configAddress: PublicKey,
  permissions = {
    updateConfig: true,
    verifyPurchases: true,
    depositTokens: true,
    manageGuardians: true,
    endSale: true,
    updateSale: true,
    withdrawFunds: true,
  }
) {
  // Create guardian authority
  const guardianAuthority = createUser(svm, umi);

  // Find guardian PDA
  const [guardianAddress] = findGuardianPda(umi, guardianAuthority.publicKey);

  // Initialize guardian
  umi.use(signerIdentity(admin));
  const initializeGuardianTx = await initializeGuardian(umi, {
    config: configAddress,
    guardian: guardianAddress,
    authority: guardianAuthority.publicKey,
    admin: admin,
    permissions: {
      updateConfig: permissions.updateConfig,
      verifyPurchases: permissions.verifyPurchases,
      depositTokens: permissions.depositTokens,
      manageGuardians: permissions.manageGuardians,
      endSale: permissions.endSale,
      updateSale: permissions.updateSale,
      withdrawFunds: permissions.withdrawFunds,
    },
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(initializeGuardianTx));
  // console.log("Initialize Guardian Transaction Result:", result.toString());

  // Get guardian data - add error handling
  const guardianAccount = svm.getAccount(toWeb3JsPublicKey(guardianAddress));
  const guardianSerializer = getGuardianAccountDataSerializer();
  const [guardian] = guardianSerializer.deserialize(guardianAccount.data);

  return {
    guardianAddress,
    guardian,
    guardianAuthority,
  };
}

/**
 * Updates guardian account permissions and returns relevant data
 */
export async function updateGuardianAccount(
  svm: LiteSVM,
  umi: Umi,
  admin: any,
  guardianAddress: PublicKey,
  configAddress: PublicKey,
  permissions = {
    updateConfig: true,
    verifyPurchases: true,
    depositTokens: true,
    manageGuardians: true,
    endSale: true,
    updateSale: true,
    withdrawFunds: true,
  }
) {
  // Update guardian
  umi.use(signerIdentity(admin));
  const updateGuardianTx = await updateGuardian(umi, {
    admin: admin,
    config: configAddress,
    guardian: guardianAddress,
    permissions: {
      updateConfig: permissions.updateConfig,
      verifyPurchases: permissions.verifyPurchases,
      depositTokens: permissions.depositTokens,
      manageGuardians: permissions.manageGuardians,
      endSale: permissions.endSale,
      updateSale: permissions.updateSale,
      withdrawFunds: permissions.withdrawFunds,
    },
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(updateGuardianTx));
  // console.log("Update Guardian Transaction Result:", result.toString());

  // Get updated guardian data
  const guardianAccount = svm.getAccount(toWeb3JsPublicKey(guardianAddress));
  const guardianSerializer = getGuardianAccountDataSerializer();
  const [guardian] = guardianSerializer.deserialize(guardianAccount.data);

  return {
    guardianAddress,
    guardian,
  };
}

/**
 * Updates sale account and returns relevant data
 */
export async function updateSaleAccount(
  svm: LiteSVM,
  umi: Umi,
  params: {
    authority: any;
    guardian: PublicKey;
    sale: PublicKey;
    purchaseMint?: PublicKey;
    paymentMint?: PublicKey;
    guardPurchases?: boolean | null;
    paymentAmount?: number | bigint | null;
    maxTokensTotal?: number | bigint | null;
    maxTokensPerUser?: number | bigint | null;
    startTimestamp?: number | bigint | null;
    endTimestamp?: number | bigint | null;
  }
) {
  // Update sale
  umi.use(signerIdentity(params.authority));
  const updateSaleTx = await updateSale(umi, {
    authority: params.authority,
    guardian: params.guardian,
    sale: params.sale,
    purchaseMint: params.purchaseMint,
    paymentMint: params.paymentMint,
    guardPurchases: params.guardPurchases,
    paymentAmount: params.paymentAmount,
    maxTokensTotal: params.maxTokensTotal,
    maxTokensPerUser: params.maxTokensPerUser,
    startTimestamp: params.startTimestamp,
    endTimestamp: params.endTimestamp,
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(updateSaleTx));
  // console.log("Update Sale Transaction Result:", result.toString());

  // Get updated sale data
  const saleAccount = svm.getAccount(toWeb3JsPublicKey(params.sale));
  const saleSerializer = getSaleAccountDataSerializer();
  const [sale] = saleSerializer.deserialize(saleAccount.data);

  return {
    saleAddress: params.sale,
    sale,
  };
}

/**
 * Ends a sale and returns relevant data
 */
export async function endSaleAccount(
  svm: LiteSVM,
  umi: Umi,
  authority: any,
  guardian: PublicKey,
  sale: PublicKey
) {
  // End sale
  umi.use(signerIdentity(authority));
  const endSaleTx = await endSale(umi, {
    authority,
    guardian,
    sale,
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(endSaleTx));
  // console.log("End Sale Transaction Result:", result.toString());

  // Get updated sale data
  const saleAccount = svm.getAccount(toWeb3JsPublicKey(sale));
  const saleSerializer = getSaleAccountDataSerializer();
  const [updatedSale] = saleSerializer.deserialize(saleAccount.data);

  return {
    saleAddress: sale,
    sale: updatedSale,
  };
}

/**
 * Purchases tokens from a sale and returns relevant data
 */
export async function purchaseTokensFromSale(
  svm: LiteSVM,
  umi: Umi,
  params: {
    buyer: any;
    authority?: any;
    guardian?: PublicKey;
    sale: PublicKey;
    buyerPaymentAta?: PublicKey;
    salePaymentAta?: PublicKey;
    paymentPriceUpdate?: PublicKey;
    paymentProgram: PublicKey;
    amountToPurchase: number | bigint;
  }
) {
  // Purchase tokens
  umi.use(signerIdentity(params.buyer));

  // Find receipt PDA
  const [receiptAddress] = findReceiptPda(
    umi,
    params.buyer.publicKey,
    params.sale
  );
  // console.log("Receipt Address:", receiptAddress.toString());

  const purchaseTokensTx = await purchaseTokens(umi, {
    buyer: params.buyer,
    authority: params.authority,
    guardian: params.guardian,
    sale: params.sale,
    receipt: receiptAddress,
    buyerPaymentAta: params.buyerPaymentAta,
    salePaymentAta: params.salePaymentAta,
    paymentPriceUpdate: params.paymentPriceUpdate,
    paymentProgram: params.paymentProgram,
    amountToPurchase: params.amountToPurchase,
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(purchaseTokensTx));
  // console.log("Purchase Tokens Transaction Result:", result.toString());

  // Get updated sale and receipt data
  const saleAccount = svm.getAccount(toWeb3JsPublicKey(params.sale));
  const saleSerializer = getSaleAccountDataSerializer();
  const [updatedSale] = saleSerializer.deserialize(saleAccount.data);

  const receiptAccount = svm.getAccount(toWeb3JsPublicKey(receiptAddress));
  const receiptSerializer = getReceiptAccountDataSerializer();
  const [receipt] = receiptSerializer.deserialize(receiptAccount.data);

  return {
    saleAddress: params.sale,
    sale: updatedSale,
    receiptAddress,
    receipt,
    result,
  };
}

/**
 * Deposits tokens to a sale and returns relevant data
 */
export async function depositTokensToSale(
  svm: LiteSVM,
  umi: Umi,
  params: {
    authority: any;
    guardian: PublicKey;
    sale: PublicKey;
    salePurchaseAta: PublicKey;
    authorityPurchaseAta: PublicKey;
    purchaseProgram: PublicKey;
    amountToDeposit: number | bigint;
  }
) {
  // Deposit tokens
  umi.use(signerIdentity(params.authority));
  const depositTokensTx = await depositTokens(umi, {
    authority: params.authority,
    guardian: params.guardian,
    sale: params.sale,
    salePurchaseAta: params.salePurchaseAta,
    authorityPurchaseAta: params.authorityPurchaseAta,
    purchaseProgram: params.purchaseProgram,
    amountToDeposit: params.amountToDeposit,
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(depositTokensTx));
  // console.log("Deposit Tokens Transaction Result:", result.toString());

  // Get updated sale data
  const saleAccount = svm.getAccount(toWeb3JsPublicKey(params.sale));
  const saleSerializer = getSaleAccountDataSerializer();
  const [updatedSale] = saleSerializer.deserialize(saleAccount.data);

  return {
    saleAddress: params.sale,
    sale: updatedSale,
  };
}

/**
 * Calculate the purchase cost in lamports based on the price feed data and token amount
 *
 * This function replicates the calculation in the Rust code's calculate_purchase_cost function
 * The payment_amount is in micropennies (millionths of a dollar), where:
 * - 1 micropenny = $0.000001
 * - 1,000,000 micropennies = $1.00
 *
 * @param priceUpdate The price feed data
 * @param paymentAmount The payment amount in micropennies
 * @param amountToPurchase The number of tokens to purchase
 * @returns The cost in lamports
 */
export function calculatePurchaseCost(
  priceUpdate: PriceUpdateV2AccountData,
  paymentAmount: bigint,
  amountToPurchase: bigint
): bigint {
  // Get the price and exponent from the price feed
  const price = priceUpdate.priceMessage.price;
  const exponent = priceUpdate.priceMessage.exponent;

  // Calculate base cost (in micropennies)
  const baseCost = paymentAmount * amountToPurchase;

  // Get absolute value of exponent
  const absExponent = Math.abs(Number(exponent));

  // Calculate 10^|exponent|
  const scalingFactor = BigInt(10 ** absExponent);

  // Scale lamports_per_sol by the scaling factor
  const scaledLamports = BigInt(LAMPORTS_PER_SOL) * scalingFactor;

  // Complete the calculation
  // Formula: lamports = (LAMPORTS_PER_SOL * 10^|exponent| * base_cost) / price
  const totalCost = (scaledLamports * baseCost) / price;

  return totalCost;
}

/**
 * Creates sale account and returns relevant data
 */
export async function createSaleAccount(
  svm: LiteSVM,
  umi: Umi,
  params: {
    admin: any;
    purchaseMint: PublicKey;
    paymentMint: PublicKey;
    paymentAmount: number | bigint;
    priceFeedIdHex: string;
    maxPriceFeedAge: number | bigint;
    guardPurchases?: boolean;
    maxTokensTotal?: number | bigint | null;
    maxTokensPerUser?: number | bigint | null;
    startTimestamp?: number | bigint | null;
    endTimestamp?: number | bigint | null;
    id?: number | bigint;
  }
) {
  // Find sale PDA
  const saleId = params.id ?? 1;
  const [saleAddress] = findSalePda(umi, saleId);

  // Initialize sale
  umi.use(signerIdentity(params.admin));
  const initializeSaleTx = await initializeSale(umi, {
    admin: params.admin,
    sale: saleAddress,
    purchaseMint: params.purchaseMint,
    paymentMint: params.paymentMint,
    id: params.id ?? 1,
    paymentAmount: params.paymentAmount,
    priceFeedIdHex: params.priceFeedIdHex,
    maxPriceFeedAge: params.maxPriceFeedAge,
    guardPurchases: params.guardPurchases ?? true,
    maxTokensTotal: params.maxTokensTotal ?? null,
    maxTokensPerUser: params.maxTokensPerUser ?? null,
    startTimestamp: params.startTimestamp ?? null,
    endTimestamp: params.endTimestamp ?? null,
  })
    .setBlockhash(svm.latestBlockhash())
    .buildAndSign(umi);

  const result = svm.sendTransaction(toWeb3JsTransaction(initializeSaleTx));
  // console.log("Initialize Sale Transaction Result:", result.toString());

  // Get sale data
  const saleAccount = svm.getAccount(toWeb3JsPublicKey(saleAddress));
  if (!saleAccount) {
    console.log("Initialize Sale Transaction Result:", result.toString());
  }
  const saleSerializer = getSaleAccountDataSerializer();
  const [sale] = saleSerializer.deserialize(saleAccount.data);

  return {
    saleAddress,
    sale,
    result,
  };
}
