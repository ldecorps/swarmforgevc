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
const yaml = __importStar(require("js-yaml"));
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
function parsePriority(priorityStr) {
    if (priorityStr === undefined)
        return undefined;
    const n = Number(priorityStr);
    return !Number.isNaN(n) ? n : undefined;
}
function assignOptionalFields(item, content) {
    const assignedTo = parseYamlScalar(content, 'assigned_to');
    if (assignedTo)
        item.assignedTo = assignedTo;
    const milestone = parseYamlScalar(content, 'milestone');
    if (milestone)
        item.milestone = milestone;
    const priority = parsePriority(parseYamlScalar(content, 'priority'));
    if (priority !== undefined)
        item.priority = priority;
    const dependsOn = parseYamlList(content, 'depends_on');
    if (dependsOn)
        item.dependsOn = dependsOn;
    const pack = parseYamlList(content, 'pack');
    if (pack)
        item.pack = pack;
}
function toOptionalNumber(value) {
    if (typeof value === 'number' && !Number.isNaN(value))
        return value;
    if (typeof value === 'string') {
        const n = Number(value);
        return !Number.isNaN(n) ? n : undefined;
    }
    return undefined;
}
function toOptionalStringList(value) {
    if (!Array.isArray(value))
        return undefined;
    const entries = value.map(String).filter((s) => s.length > 0);
    return entries.length > 0 ? entries : undefined;
}
// Builds a BacklogItem from a strictly-parsed js-yaml document. Reads only
// the known BacklogItem fields off the parsed object so extra keys elsewhere
// in the document (e.g. `evidence:`, `notes:`) never leak into the contract
// pinned by backlogReader.test.js.
// Split out of buildItemFromParsedObject (hardening pass, BL-129): isolates
// the required-field validation from optional-field assignment so each half
// stays independently low-complexity/testable.
function extractRequiredFields(obj) {
    const id = typeof obj.id === 'string' ? obj.id : undefined;
    const title = typeof obj.title === 'string' ? obj.title : undefined;
    const statusRaw = typeof obj.status === 'string' ? obj.status : undefined;
    if (!id || !title || !statusRaw || !VALID_STATUSES.has(statusRaw)) {
        return null;
    }
    return { id, title, status: statusRaw };
}
function assignOptionalFieldsFromObject(item, obj) {
    if (typeof obj.assigned_to === 'string' && obj.assigned_to)
        item.assignedTo = obj.assigned_to;
    if (typeof obj.milestone === 'string' && obj.milestone)
        item.milestone = obj.milestone;
    const priority = toOptionalNumber(obj.priority);
    if (priority !== undefined)
        item.priority = priority;
    const dependsOn = toOptionalStringList(obj.depends_on);
    if (dependsOn)
        item.dependsOn = dependsOn;
    const pack = toOptionalStringList(obj.pack);
    if (pack)
        item.pack = pack;
}
function buildItemFromParsedObject(obj) {
    const required = extractRequiredFields(obj);
    if (!required) {
        return null;
    }
    const item = { ...required };
    assignOptionalFieldsFromObject(item, obj);
    return item;
}
function parseBacklogYamlLenient(content) {
    const id = parseYamlScalar(content, 'id');
    const title = parseYamlScalar(content, 'title');
    const statusRaw = parseYamlScalar(content, 'status');
    if (!id || !title || !statusRaw || !VALID_STATUSES.has(statusRaw)) {
        return null;
    }
    const item = { id, title, status: statusRaw };
    assignOptionalFields(item, content);
    return item;
}
// BL-129: try a real YAML parser first; a well-formed ticket gets a real
// parse instead of regex extraction. Some real tickets have free-form titles
// or notes that are not valid strict YAML (unquoted "key: value"-shaped
// text, multiline implicit keys) — js-yaml throws or returns a non-object
// for those, and this falls back to the lenient extractor rather than
// dropping the ticket.
function parseBacklogYaml(content) {
    try {
        const parsed = yaml.load(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return buildItemFromParsedObject(parsed);
        }
    }
    catch {
        // fall through to the lenient extractor below
    }
    return parseBacklogYamlLenient(content);
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