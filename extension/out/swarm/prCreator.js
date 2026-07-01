"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentBranch = getCurrentBranch;
exports.buildPrArgs = buildPrArgs;
exports.openPullRequest = openPullRequest;
const cp = __importStar(require("child_process"));
const EXEC_ENCODING = 'utf8';
const GIT_DETACHED = 'HEAD';
const HTTPS_PREFIX = 'https://';
const DEFAULT_BASE_BRANCH = 'main';
function getCurrentBranch(targetPath) {
    try {
        const out = cp.execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: targetPath,
            encoding: EXEC_ENCODING,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const branch = out.trim();
        return branch && branch !== GIT_DETACHED ? branch : undefined;
    }
    catch {
        return undefined;
    }
}
function buildPrArgs(title, baseBranch = DEFAULT_BASE_BRANCH) {
    return ['pr', 'create', '--title', title, '--base', baseBranch, '--fill'];
}
function extractPrUrl(output) {
    return output
        .trim()
        .split('\n')
        .find((l) => l.startsWith(HTTPS_PREFIX));
}
function openPullRequest(targetPath, title, baseBranch = DEFAULT_BASE_BRANCH) {
    try {
        const args = buildPrArgs(title, baseBranch);
        const cmd = `gh ${args.join(' ')}`;
        const output = cp.execSync(cmd, {
            cwd: targetPath,
            encoding: EXEC_ENCODING,
        });
        const url = extractPrUrl(output);
        return {
            success: true,
            url,
            message: url ? `PR created: ${url}` : 'PR created.',
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Failed to create PR: ${message}` };
    }
}
//# sourceMappingURL=prCreator.js.map