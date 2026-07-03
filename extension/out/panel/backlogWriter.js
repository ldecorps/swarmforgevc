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
exports.setAssignedTo = setAssignedTo;
exports.markDone = markDone;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const backlogReader_1 = require("./backlogReader");
const atomicWrite_1 = require("../util/atomicWrite");
const ASSIGNED_TO_LINE = /^assigned_to:\s*.+$/m;
function findMatchingBacklogFile(dir, itemId) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
        const filePath = path.join(dir, file);
        try {
            const item = (0, backlogReader_1.parseBacklogYaml)(fs.readFileSync(filePath, 'utf8'));
            if (item && item.id === itemId) {
                return filePath;
            }
        }
        catch {
            continue;
        }
    }
    return null;
}
function findActiveBacklogFilePath(targetPath, itemId) {
    const dir = path.join(targetPath, 'backlog', 'active');
    try {
        return findMatchingBacklogFile(dir, itemId);
    }
    catch {
        return null;
    }
}
// Only the assigned_to field is writable from the panel (BL-034); every
// other line is left byte-identical, so this edits the field in place with
// a targeted regex rather than regenerating the file from parsed structure.
function setAssignedTo(targetPath, itemId, assignedTo) {
    const filePath = findActiveBacklogFilePath(targetPath, itemId);
    if (!filePath) {
        return false;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (!ASSIGNED_TO_LINE.test(content)) {
        return false;
    }
    (0, atomicWrite_1.atomicWrite)(filePath, content.replace(ASSIGNED_TO_LINE, `assigned_to: ${assignedTo}`));
    return true;
}
// Moves the file only - it never rewrites the status field. The done/
// folder is the authoritative signal (BL-033), matching readBacklog's own
// override of done-folder items regardless of their YAML status.
function markDone(targetPath, itemId) {
    const filePath = findActiveBacklogFilePath(targetPath, itemId);
    if (!filePath) {
        return { moved: false };
    }
    const item = (0, backlogReader_1.parseBacklogYaml)(fs.readFileSync(filePath, 'utf8'));
    const destDir = item?.milestone
        ? path.join(targetPath, 'backlog', 'done', item.milestone)
        : path.join(targetPath, 'backlog', 'done');
    fs.mkdirSync(destDir, { recursive: true });
    const destination = path.join(destDir, path.basename(filePath));
    fs.renameSync(filePath, destination);
    return { moved: true, destination };
}
//# sourceMappingURL=backlogWriter.js.map