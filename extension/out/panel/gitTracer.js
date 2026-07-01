"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastCommitForItem = lastCommitForItem;
const child_process_1 = require("child_process");
function lastCommitForItem(targetPath, id) {
    try {
        const output = (0, child_process_1.execSync)(`git -C ${JSON.stringify(targetPath)} log --oneline --grep=${JSON.stringify(id + ':')} -1`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (!output) {
            return null;
        }
        const spaceIdx = output.indexOf(' ');
        if (spaceIdx === -1) {
            return null;
        }
        return { hash: output.slice(0, spaceIdx), message: output.slice(spaceIdx + 1) };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=gitTracer.js.map