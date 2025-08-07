"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVerificationLevelSerializer = getVerificationLevelSerializer;
exports.verificationLevel = verificationLevel;
exports.isVerificationLevel = isVerificationLevel;
const serializers_1 = require("@metaplex-foundation/umi/serializers");
function getVerificationLevelSerializer() {
    return (0, serializers_1.dataEnum)([
        [
            'Partial',
            (0, serializers_1.struct)([
                ['numSignatures', (0, serializers_1.u8)()],
            ]),
        ],
        ['Full', (0, serializers_1.unit)()],
    ], { description: 'VerificationLevel' });
}
function verificationLevel(kind, data) {
    return { __kind: kind, ...(data ?? {}) };
}
function isVerificationLevel(kind, value) {
    return value.__kind === kind;
}
//# sourceMappingURL=verificationLevel.js.map