"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPriceFeedMessageSerializer = getPriceFeedMessageSerializer;
const serializers_1 = require("@metaplex-foundation/umi/serializers");
function getPriceFeedMessageSerializer() {
    return (0, serializers_1.struct)([
        ['feedId', (0, serializers_1.bytes)({ size: 32 })],
        ['price', (0, serializers_1.i64)()],
        ['conf', (0, serializers_1.u64)()],
        ['exponent', (0, serializers_1.i32)()],
        ['publishTime', (0, serializers_1.i64)()],
        ['prevPublishTime', (0, serializers_1.i64)()],
        ['emaPrice', (0, serializers_1.i64)()],
        ['emaConf', (0, serializers_1.u64)()],
    ], { description: 'PriceFeedMessage' });
}
//# sourceMappingURL=priceFeedMessage.js.map