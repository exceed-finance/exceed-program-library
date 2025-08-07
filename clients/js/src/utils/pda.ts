import { Pda, PublicKey, Umi } from "@metaplex-foundation/umi";
import {
  publicKey as publicKeySerializer,
  string,
  i64,
} from "@metaplex-foundation/umi/serializers";

export const findAccessControlPda = (umi: Umi): Pda => {
  return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
    string({ size: "variable" }).serialize("access_control"),
  ]);
};

export const findLstPda = (umi: Umi, symbol: string): Pda => {
  return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
    string({ size: "variable" }).serialize("lst_mint"),
    string({ size: "variable" }).serialize(symbol),
  ]);
};

export const findPairPda = (umi: Umi, base: PublicKey, lst: PublicKey): Pda => {
  return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
    string({ size: "variable" }).serialize("pair"),
    publicKeySerializer().serialize(base),
    publicKeySerializer().serialize(lst),
  ]);
};

export const findWithdrawalWindowPda = (
  umi: Umi,
  pair: PublicKey,
  startTime: number | bigint
): Pda => {
  return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
    string({ size: "variable" }).serialize("withdrawal_window"),
    publicKeySerializer().serialize(pair),
    i64().serialize(startTime),
  ]);
};

export const findWithdrawalRequestPda = (
  umi: Umi,
  withdrawalWindow: PublicKey,
  staker: PublicKey
): Pda => {
  return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
    string({ size: "variable" }).serialize("withdrawal_request"),
    publicKeySerializer().serialize(withdrawalWindow),
    publicKeySerializer().serialize(staker),
  ]);
};
