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
exports.respawnCooldownPath = respawnCooldownPath;
exports.readRespawnCooldownUntilMs = readRespawnCooldownUntilMs;
exports.writeRespawnCooldownUntilMs = writeRespawnCooldownUntilMs;
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
const cooldownScheduler_1 = require("./cooldownScheduler");
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
// BL-087: rate-limits respawns per role so a repeated misjudgment cannot
// loop. Stored one level up from inbox/new, sibling to inbox/in_process,
// since a respawn cooldown is a per-ROLE fact, not tied to any one item file.
function respawnCooldownPath(inboxNewDir) {
    return path.join(path.dirname(inboxNewDir), 'respawn-cooldown.json');
}
// The explicit 'utf-8' encoding argument on the read/write pair below is
// unkillable by mutation to '' for this JSON-of-a-number payload: Node's
// Buffer-to-string coercion (which JSON.parse and the writeFileSync string
// path both fall back to) already defaults to utf8, so both encodings
// produce byte-identical results here. Kept for explicitness, not
// testability.
function readRespawnCooldownUntilMs(inboxNewDir) {
    try {
        const data = JSON.parse(fs.readFileSync(respawnCooldownPath(inboxNewDir), 'utf-8'));
        return typeof data.untilMs === 'number' ? data.untilMs : null;
    }
    catch {
        return null;
    }
}
function writeRespawnCooldownUntilMs(inboxNewDir, untilMs) {
    fs.writeFileSync(respawnCooldownPath(inboxNewDir), JSON.stringify({ untilMs }), 'utf-8');
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
// BL-087: absence of heartbeat evidence must never, by itself, justify a
// respawn — the heartbeat file this reads from routinely does not exist, so
// liveness alone reported 'unknown' for every role and respawned it on the
// FIRST stale sweep, with no chase ever attempted first. Recent pane/outbox
// activity is positive proof of life and overrides liveness entirely; absent
// that, a role is chased across successive sweeps and only escalates to a
// respawn once chase attempts are exhausted (maxChases) AND liveness itself
// is not the explicit 'alive' state (which, like fresh activity, is treated
// as positive evidence and dead-letters instead of respawning).
function isUnresponsiveLiveness(liveness) {
    return liveness === 'dead' || liveness === 'unknown' || liveness === 'stuck';
}
// Split out of decideItemAction (CRAP): the chase-exhausted decision once a
// role shows no recent activity - respawn only for a liveness reading that
// is itself evidence of unresponsiveness, dead-letter otherwise.
function decideStaleItemAction(chaseCount, config, liveness) {
    if (chaseCount < config.maxChases) {
        return 'chased';
    }
    return isUnresponsiveLiveness(liveness) ? 'respawned' : 'dead-lettered';
}
function decideItemAction(itemMtimeMs, chaseCount, nowMs, config, liveness, lastActivityMs) {
    const ageSeconds = (nowMs - itemMtimeMs) / 1000;
    if (ageSeconds < config.chaseTimeoutSeconds) {
        return 'skipped';
    }
    const idleSeconds = (nowMs - lastActivityMs) / 1000;
    const hasRecentActivity = idleSeconds < config.stuckInProcessTimeoutSeconds;
    if (hasRecentActivity) {
        return chaseCount >= config.maxChases ? 'dead-lettered' : 'chased';
    }
    return decideStaleItemAction(chaseCount, config, liveness);
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
function decideStuckAction(lastActivityMs, nudgeCount, nowMs, config) {
    // Stuck is judged by AGENT INACTIVITY while holding work, not by how long
    // the item has been held: an agent legitimately working a parcel for hours
    // shows pane/outbox activity and must never be chased (BL-067).
    const idleSeconds = (nowMs - lastActivityMs) / 1000;
    if (idleSeconds < config.stuckInProcessTimeoutSeconds) {
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
// A role that HOLDS in_process work (single task file or batch directory)
// while showing no activity gets chased; after maxChases without recovery it
// escalates visibly instead of being chased forever (BL-067).
function applyStuckNudge(role, held, adapters) {
    adapters.sendWakeUp(role);
    for (const item of held) {
        writeNudgeCount(item.filePath, item.nudgeCount + 1);
    }
    adapters.onStuckEscalation(role, false);
}
function clearStaleNudgeCounts(held) {
    for (const item of held) {
        if (item.nudgeCount > 0) {
            writeNudgeCount(item.filePath, 0);
        }
    }
}
function sweepInProcess(role, inProcessDir, nowMs, config, adapters) {
    const held = scanInProcess(inProcessDir);
    if (held.length === 0) {
        adapters.onStuckEscalation(role, false);
        return;
    }
    const nudgeCount = Math.max(...held.map((item) => item.nudgeCount));
    const action = decideStuckAction(adapters.getLastActivityMs(role), nudgeCount, nowMs, config);
    if (action === 'nudge') {
        applyStuckNudge(role, held, adapters);
    }
    else if (action === 'alert') {
        adapters.onStuckEscalation(role, true);
    }
    else {
        // active again: clear stale counts so a future stall re-chases from zero
        clearStaleNudgeCounts(held);
        adapters.onStuckEscalation(role, false);
    }
}
function maybeWakeOnCooldownExpiry(role, cooldownUntilMs, nowMs, adapters) {
    if (cooldownUntilMs == null) {
        return;
    }
    if (!(0, cooldownScheduler_1.shouldWakeOnExpiry)(cooldownUntilMs, nowMs, adapters.getCooldownWokenMarker?.(role) ?? null)) {
        return;
    }
    adapters.sendWakeUp(role);
    adapters.onCooldownExpired?.(role, cooldownUntilMs);
}
function applyInboxItemAction(role, item, action, adapters) {
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
function sweepRoleInbox(role, inboxNewDir, nowMs, config, adapters) {
    const items = scanInboxNew(inboxNewDir);
    const liveness = adapters.getLiveness(role);
    const lastActivityMs = adapters.getLastActivityMs(role);
    const respawnCooldownUntilMs = readRespawnCooldownUntilMs(inboxNewDir);
    for (const item of items) {
        let action = decideItemAction(item.mtimeMs, item.chaseCount, nowMs, config, liveness, lastActivityMs);
        // BL-087: a respawn decision made while still cooling down from the
        // last respawn of this role is downgraded to a chase instead - never
        // silently dropped, so a genuinely still-unresponsive role keeps
        // getting wake-up attempts rather than going quiet.
        if (action === 'respawned' && (0, cooldownScheduler_1.isCoolingDown)(respawnCooldownUntilMs, nowMs)) {
            action = 'chased';
        }
        applyInboxItemAction(role, item, action, adapters);
        if (action === 'respawned') {
            writeRespawnCooldownUntilMs(inboxNewDir, nowMs + config.respawnCooldownSeconds * 1000);
        }
    }
}
function runSweep(roleInboxes, nowMs, config, adapters) {
    for (const { role, inboxNewDir, inProcessDir } of roleInboxes) {
        const cooldownUntilMs = adapters.getCooldownUntilMs?.(role) ?? null;
        // While cooling down, suppress all wake/chase/respawn/nudge activity for
        // this role only; other roles in the same pass proceed normally (BL-082).
        if ((0, cooldownScheduler_1.isCoolingDown)(cooldownUntilMs, nowMs)) {
            continue;
        }
        maybeWakeOnCooldownExpiry(role, cooldownUntilMs, nowMs, adapters);
        sweepInProcess(role, inProcessDir, nowMs, config, adapters);
        sweepRoleInbox(role, inboxNewDir, nowMs, config, adapters);
    }
}
//# sourceMappingURL=inboxChaser.js.map