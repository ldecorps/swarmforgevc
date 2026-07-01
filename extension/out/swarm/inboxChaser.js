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
exports.sidecarPath = sidecarPath;
exports.deadLetterPath = deadLetterPath;
exports.readChaseCount = readChaseCount;
exports.writeChaseCount = writeChaseCount;
exports.scanInboxNew = scanInboxNew;
exports.decideItemAction = decideItemAction;
exports.nudgePath = nudgePath;
exports.readNudgeCount = readNudgeCount;
exports.writeNudgeCount = writeNudgeCount;
exports.scanInProcess = scanInProcess;
exports.decideStuckAction = decideStuckAction;
exports.isDoneButUndelivered = isDoneButUndelivered;
exports.runSweep = runSweep;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function sidecarPath(handoffFilePath) {
    return `${handoffFilePath}.chase.json`;
}
function deadLetterPath(handoffFilePath) {
    return `${handoffFilePath}.dead`;
}
function readChaseCount(handoffFilePath) {
    const sc = sidecarPath(handoffFilePath);
    try {
        const data = JSON.parse(fs.readFileSync(sc, 'utf-8'));
        return typeof data.chaseCount === 'number' ? data.chaseCount : 0;
    }
    catch {
        return 0;
    }
}
function writeChaseCount(handoffFilePath, count) {
    fs.writeFileSync(sidecarPath(handoffFilePath), JSON.stringify({ chaseCount: count }), 'utf-8');
}
function scanInboxNew(inboxNewDir) {
    if (!fs.existsSync(inboxNewDir)) {
        return [];
    }
    const items = [];
    for (const entry of fs.readdirSync(inboxNewDir)) {
        if (!entry.endsWith('.handoff')) {
            continue;
        }
        const filePath = path.join(inboxNewDir, entry);
        const stat = fs.statSync(filePath);
        items.push({
            filePath,
            mtimeMs: stat.mtimeMs,
            chaseCount: readChaseCount(filePath),
        });
    }
    return items;
}
function decideItemAction(itemMtimeMs, chaseCount, nowMs, config, liveness) {
    const ageSeconds = (nowMs - itemMtimeMs) / 1000;
    if (ageSeconds < config.chaseTimeoutSeconds) {
        return 'skipped';
    }
    if (chaseCount >= config.maxChases) {
        return 'dead-lettered';
    }
    if (liveness === 'dead' || liveness === 'unknown' || liveness === 'stuck') {
        return 'respawned';
    }
    return 'chased';
}
function nudgePath(itemFilePath) {
    return `${itemFilePath}.nudge`;
}
function readNudgeCount(itemFilePath) {
    try {
        const data = JSON.parse(fs.readFileSync(nudgePath(itemFilePath), 'utf-8'));
        return typeof data.nudgeCount === 'number' ? data.nudgeCount : 0;
    }
    catch {
        return 0;
    }
}
function writeNudgeCount(itemFilePath, count) {
    fs.writeFileSync(nudgePath(itemFilePath), JSON.stringify({ nudgeCount: count }), 'utf-8');
}
function scanInProcess(inProcessDir) {
    if (!fs.existsSync(inProcessDir)) {
        return [];
    }
    const items = [];
    function collectHandoffs(dir) {
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory() && entry.startsWith('batch_')) {
                collectHandoffs(full);
            }
            else if (entry.endsWith('.handoff')) {
                items.push({ filePath: full, mtimeMs: stat.mtimeMs, nudgeCount: readNudgeCount(full) });
            }
        }
    }
    collectHandoffs(inProcessDir);
    return items;
}
function decideStuckAction(itemMtimeMs, nudgeCount, nowMs, config) {
    const ageSeconds = (nowMs - itemMtimeMs) / 1000;
    if (ageSeconds < config.stuckInProcessTimeoutSeconds) {
        return 'skipped';
    }
    return nudgeCount >= config.maxChases ? 'alert' : 'nudge';
}
function isDoneButUndelivered(inProcessItems, latestCommitMs, lastSentMs, nowMs, config) {
    if (inProcessItems.length === 0) {
        return false;
    }
    if (latestCommitMs <= lastSentMs) {
        return false;
    }
    const ageSeconds = (nowMs - latestCommitMs) / 1000;
    return ageSeconds >= config.stuckInProcessTimeoutSeconds;
}
function runSweep(roleInboxes, nowMs, config, adapters) {
    for (const { role, inboxNewDir } of roleInboxes) {
        const items = scanInboxNew(inboxNewDir);
        const liveness = adapters.getLiveness(role);
        for (const item of items) {
            const action = decideItemAction(item.mtimeMs, item.chaseCount, nowMs, config, liveness);
            if (action === 'chased') {
                adapters.sendWakeUp(role);
                writeChaseCount(item.filePath, item.chaseCount + 1);
            }
            else if (action === 'respawned') {
                adapters.triggerRespawn(role);
            }
            else if (action === 'dead-lettered') {
                const dead = deadLetterPath(item.filePath);
                fs.renameSync(item.filePath, dead);
                const sc = sidecarPath(item.filePath);
                if (fs.existsSync(sc)) {
                    fs.renameSync(sc, sidecarPath(dead));
                }
                adapters.logDeadLetter(role, item.filePath);
            }
            // 'skipped' → no-op
        }
    }
}
//# sourceMappingURL=inboxChaser.js.map