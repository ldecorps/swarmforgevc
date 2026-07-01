"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripAnsi = stripAnsi;
function stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}
//# sourceMappingURL=ansi.js.map