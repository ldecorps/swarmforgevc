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
exports.WorktreeManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const BASE_ROLES = new Set(['coordinator', 'specifier']);
class WorktreeManager {
    repoPath;
    worktrees = [];
    constructor(repoPath) {
        this.repoPath = repoPath;
    }
    setup(roles) {
        const subordinates = roles.filter((r) => !BASE_ROLES.has(r));
        for (const role of subordinates) {
            const worktreePath = path.join(this.repoPath, '.worktrees', role);
            const branch = `swarm/${role}`;
            fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
            (0, child_process_1.execSync)(`git worktree add -b ${branch} ${worktreePath}`, { cwd: this.repoPath, stdio: 'pipe' });
            this.worktrees.push({ role, worktreePath, branch });
        }
    }
    list() {
        return [...this.worktrees];
    }
    getPath(role) {
        if (BASE_ROLES.has(role)) {
            return this.repoPath;
        }
        const entry = this.worktrees.find((w) => w.role === role);
        return entry ? entry.worktreePath : this.repoPath;
    }
    teardown() {
        for (const entry of this.worktrees) {
            try {
                (0, child_process_1.execSync)(`git worktree remove --force ${entry.worktreePath}`, {
                    cwd: this.repoPath,
                    stdio: 'pipe',
                });
                (0, child_process_1.execSync)(`git branch -D ${entry.branch}`, {
                    cwd: this.repoPath,
                    stdio: 'pipe',
                });
            }
            catch {
                // best-effort cleanup
            }
        }
        this.worktrees = [];
    }
}
exports.WorktreeManager = WorktreeManager;
//# sourceMappingURL=WorktreeManager.js.map