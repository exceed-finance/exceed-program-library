"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findWithdrawalRequestPda = exports.findWithdrawalWindowPda = exports.findPairPda = exports.findLstPda = exports.findAccessControlPda = void 0;
const serializers_1 = require("@metaplex-foundation/umi/serializers");
const findAccessControlPda = (umi) => {
    return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
        (0, serializers_1.string)({ size: "variable" }).serialize("access_control"),
    ]);
};
exports.findAccessControlPda = findAccessControlPda;
const findLstPda = (umi, symbol) => {
    return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
        (0, serializers_1.string)({ size: "variable" }).serialize("lst_mint"),
        (0, serializers_1.string)({ size: "variable" }).serialize(symbol),
    ]);
};
exports.findLstPda = findLstPda;
const findPairPda = (umi, base, lst) => {
    return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
        (0, serializers_1.string)({ size: "variable" }).serialize("pair"),
        (0, serializers_1.publicKey)().serialize(base),
        (0, serializers_1.publicKey)().serialize(lst),
    ]);
};
exports.findPairPda = findPairPda;
const findWithdrawalWindowPda = (umi, pair, startTime) => {
    return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
        (0, serializers_1.string)({ size: "variable" }).serialize("withdrawal_window"),
        (0, serializers_1.publicKey)().serialize(pair),
        (0, serializers_1.i64)().serialize(startTime),
    ]);
};
exports.findWithdrawalWindowPda = findWithdrawalWindowPda;
const findWithdrawalRequestPda = (umi, withdrawalWindow, staker) => {
    return umi.eddsa.findPda(umi.programs.getPublicKey("liquidStaking"), [
        (0, serializers_1.string)({ size: "variable" }).serialize("withdrawal_request"),
        (0, serializers_1.publicKey)().serialize(withdrawalWindow),
        (0, serializers_1.publicKey)().serialize(staker),
    ]);
};
exports.findWithdrawalRequestPda = findWithdrawalRequestPda;
//# sourceMappingURL=pda.js.map