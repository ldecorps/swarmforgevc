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
exports.parseRolesTsv = parseRolesTsv;
exports.readHandoffInboxStatus = readHandoffInboxStatus;
exports.readPipelineStages = readPipelineStages;
exports.currentStageLabel = currentStageLabel;
exports.findLiveHolder = findLiveHolder;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const SWARMFORGE_DIR = '.swarmforge';
const HANDOFF_EXTENSION = '.handoff';
const INBOX_SUBDIRS = ['new', 'in_process'];
const TSV_ROLE_INDEX = 0;
const TSV_WORKTREE_INDEX = 2;
const TSV_DISPLAY_NAME_INDEX = 4;
function parseRolesTsv(tsv) {
    const entries = [];
    for (const line of tsv.split('\n')) {
        if (!line.trim()) {
            continue;
        }
        const parts = line.split('\t');
        const role = parts[TSV_ROLE_INDEX];
        const worktreePath = parts[TSV_WORKTREE_INDEX];
        const displayName = parts[TSV_DISPLAY_NAME_INDEX];
        if (role && worktreePath && displayName) {
            entries.push({ role, worktreePath, displayName });
        }
    }
    return entries;
}
function readHandoffInboxStatus(worktreePath) {
    const inboxBase = path.join(worktreePath, SWARMFORGE_DIR, 'handoffs', 'inbox');
    for (const subdir of INBOX_SUBDIRS) {
        const dir = path.join(inboxBase, subdir);
        if (!fs.existsSync(dir)) {
            continue;
        }
        if (hasHandoffFiles(dir)) {
            return 'active';
        }
    }
    return 'idle';
}
function hasHandoffFiles(dir) {
    try {
        for (const entry of fs.readdirSync(dir)) {
            if (entry.endsWith(HANDOFF_EXTENSION)) {
                return true;
            }
            const fullPath = path.join(dir, entry);
            if (fs.statSync(fullPath).isDirectory()) {
                if (fs.readdirSync(fullPath).some((f) => f.endsWith(HANDOFF_EXTENSION))) {
                    return true;
                }
            }
        }
    }
    catch {
        // ignore unreadable dirs
    }
    return false;
}
function readPipelineStages(targetPath) {
    const rolesFile = path.join(targetPath, SWARMFORGE_DIR, 'roles.tsv');
    if (!fs.existsSync(rolesFile)) {
        return [];
    }
    const tsv = fs.readFileSync(rolesFile, 'utf8');
    return parseRolesTsv(tsv).map((entry) => ({
        role: entry.role,
        displayName: entry.displayName,
        status: readHandoffInboxStatus(entry.worktreePath),
    }));
}
function currentStageLabel(stages) {
    const active = stages.filter((s) => s.status === 'active');
    if (active.length === 0) {
        return 'idle';
    }
    return active.map((s) => s.displayName).join(', ');
}
function parseHandoffTask(content) {
    const match = content.match(/^task:\s*(.+)$/m);
    return match ? match[1].trim() : null;
}
function readHandoffFilesFromInbox(inboxPath) {
    const handoffs = [];
    for (const subdir of INBOX_SUBDIRS) {
        const dir = path.join(inboxPath, subdir);
        if (!fs.existsSync(dir)) {
            continue;
        }
        try {
            for (const entry of fs.readdirSync(dir)) {
                if (entry.endsWith(HANDOFF_EXTENSION)) {
                    const filePath = path.join(dir, entry);
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        const task = parseHandoffTask(content);
                        handoffs.push({ task });
                    }
                    catch {
                        // ignore unreadable handoff files
                    }
                }
                else {
                    // Check batch directories
                    const fullPath = path.join(dir, entry);
                    if (fs.statSync(fullPath).isDirectory()) {
                        try {
                            for (const batchFile of fs.readdirSync(fullPath)) {
                                if (batchFile.endsWith(HANDOFF_EXTENSION)) {
                                    const filePath = path.join(fullPath, batchFile);
                                    try {
                                        const content = fs.readFileSync(filePath, 'utf8');
                                        const task = parseHandoffTask(content);
                                        handoffs.push({ task });
                                    }
                                    catch {
                                        // ignore unreadable handoff files
                                    }
                                }
                            }
                        }
                        catch {
                            // ignore unreadable batch directories
                        }
                    }
                }
            }
        }
        catch {
            // ignore unreadable inbox directories
        }
    }
    return handoffs;
}
function findLiveHolder(targetPath, itemId) {
    const stages = readPipelineStages(targetPath);
    const rolesFile = path.join(targetPath, SWARMFORGE_DIR, 'roles.tsv');
    if (!fs.existsSync(rolesFile)) {
        return null;
    }
    const tsv = fs.readFileSync(rolesFile, 'utf8');
    const roles = parseRolesTsv(tsv);
    // For each active stage, check if it has a handoff with the matching task
    for (const stage of stages) {
        if (stage.status !== 'active') {
            continue;
        }
        const role = roles.find((r) => r.role === stage.role);
        if (!role) {
            continue;
        }
        const inboxPath = path.join(role.worktreePath, SWARMFORGE_DIR, 'handoffs', 'inbox');
        const handoffs = readHandoffFilesFromInbox(inboxPath);
        for (const handoff of handoffs) {
            if (handoff.task && handoff.task.toLowerCase().startsWith(itemId.toLowerCase())) {
                return stage.role;
            }
        }
    }
    return null;
}
//# sourceMappingURL=swarmState.js.map