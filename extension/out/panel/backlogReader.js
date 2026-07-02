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
exports.parseBacklogYaml = parseBacklogYaml;
exports.readBacklog = readBacklog;
exports.readBacklogFolders = readBacklogFolders;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const VALID_STATUSES = new Set(['todo', 'active', 'done']);
function parseYamlScalar(content, field) {
    const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : undefined;
}
function parseYamlList(content, field) {
    const blockMatch = content.match(new RegExp(`^${field}:\\s*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, 'm'));
    if (!blockMatch) {
        return undefined;
    }
    const entries = blockMatch[1]
        .split('\n')
        .map((line) => line.replace(/^\s*-\s*/, '').replace(/#.*$/, '').trim())
        .filter((line) => line.length > 0);
    return entries.length > 0 ? entries : undefined;
}
function parseBacklogYaml(content) {
    const id = parseYamlScalar(content, 'id');
    const title = parseYamlScalar(content, 'title');
    const statusRaw = parseYamlScalar(content, 'status');
    if (!id || !title || !statusRaw) {
        return null;
    }
    if (!VALID_STATUSES.has(statusRaw)) {
        return null;
    }
    const item = { id, title, status: statusRaw };
    const assignedTo = parseYamlScalar(content, 'assigned_to');
    if (assignedTo) {
        item.assignedTo = assignedTo;
    }
    const milestone = parseYamlScalar(content, 'milestone');
    if (milestone) {
        item.milestone = milestone;
    }
    const priorityStr = parseYamlScalar(content, 'priority');
    if (priorityStr !== undefined) {
        const n = Number(priorityStr);
        if (!Number.isNaN(n)) {
            item.priority = n;
        }
    }
    const dependsOn = parseYamlList(content, 'depends_on');
    if (dependsOn) {
        item.dependsOn = dependsOn;
    }
    return item;
}
function readYamlFiles(dir, overrideStatus) {
    let files;
    try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));
    }
    catch {
        return [];
    }
    return files.flatMap((f) => {
        try {
            const content = fs.readFileSync(path.join(dir, f), 'utf-8');
            const item = parseBacklogYaml(content);
            if (item && overrideStatus !== undefined) {
                item.status = overrideStatus;
            }
            return item ? [item] : [];
        }
        catch {
            return [];
        }
    });
}
const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;
// Done tickets are grouped into per-milestone subfolders
// (backlog/done/<milestone>/*.yaml); flat files are still accepted during the
// transition. One level of subfolders is the contract — deeper nesting is
// ignored. The subfolder name is canonical for the item's milestone.
function readDoneItems(doneDir) {
    const flatItems = readYamlFiles(doneDir, 'done');
    let subdirs;
    try {
        subdirs = fs
            .readdirSync(doneDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    }
    catch {
        return flatItems;
    }
    const groupedItems = subdirs.flatMap((milestone) => readYamlFiles(path.join(doneDir, milestone), 'done').map((item) => ({
        ...item,
        milestone,
    })));
    return [...flatItems, ...groupedItems];
}
function readBacklog(targetPath) {
    // The folder is authoritative: the pipeline moves files between backlog
    // folders without touching the yaml status field, so a promoted item may
    // still say "status: todo".
    const activeItems = readYamlFiles(path.join(targetPath, 'backlog', 'active'), 'active');
    const doneItems = readDoneItems(path.join(targetPath, 'backlog', 'done'));
    activeItems.sort((a, b) => (a.priority ?? MAX_PRIORITY) - (b.priority ?? MAX_PRIORITY));
    return [...activeItems, ...doneItems];
}
// Unlike readBacklog (which normalizes for the panel's own display), this
// projects the three backlog folders as-is for consumers, such as the read
// bridge, that need to know which folder a ticket currently sits in.
function readBacklogFolders(targetPath) {
    return {
        active: readYamlFiles(path.join(targetPath, 'backlog', 'active')),
        paused: readYamlFiles(path.join(targetPath, 'backlog', 'paused')),
        done: readDoneItems(path.join(targetPath, 'backlog', 'done')),
    };
}
//# sourceMappingURL=backlogReader.js.map