"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTargetPath = resolveTargetPath;
function resolveTargetPath(input) {
    const configured = input.configuredTargetPath?.trim();
    if (configured) {
        return configured;
    }
    const folders = input.workspaceFolders ?? [];
    if (folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return undefined;
}
//# sourceMappingURL=targetPath.js.map