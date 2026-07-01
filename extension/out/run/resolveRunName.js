"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRunName = resolveRunName;
function resolveRunName(opts) {
    if (!opts.promptEnabled) {
        return opts.defaultName;
    }
    if (opts.promptResult === undefined) {
        return undefined;
    }
    return opts.promptResult.trim() || opts.defaultName;
}
//# sourceMappingURL=resolveRunName.js.map