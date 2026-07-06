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
exports.parseHandoffHeaderField = parseHandoffHeaderField;
exports.listDeadLettersForRole = listDeadLettersForRole;
exports.listDeadLetters = listDeadLetters;
exports.readChaseCount = readChaseCount;
exports.readLastChasedAtMs = readLastChasedAtMs;
exports.writeChaseCount = writeChaseCount;
exports.respawnCooldownPath = respawnCooldownPath;
exports.readRespawnCooldownUntilMs = readRespawnCooldownUntilMs;
exports.writeRespawnCooldownUntilMs = writeRespawnCooldownUntilMs;
exports.scanInboxNew = scanInboxNew;
exports.computeChaseBackoffSeconds = computeChaseBackoffSeconds;
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
// BL-109 dead-letter-visible-03: a dead-lettered handoff was previously
// invisible debris - renamed to `<name>.handoff.dead` next to a
// `.chase.json` sidecar nothing read back, indistinguishable from success to
// the sender. Parses the header block any handoff file carries (see
// handoff-protocol.md) so a listing can show who it was for and what it was.
function parseHandoffHeaderField(content, field) {
    const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : undefined;
}
// The recipient a dead-lettered file was originally destined for is the
// role whose inbox/new it was found in - deadLetterPath renames it in place,
// it never moves out of that role's own directory tree.
function listDeadLettersForRole(role, inboxNewDir) {
    if (!fs.existsSync(inboxNewDir)) {
        return [];
    }
    const found = [];
    for (const entry of fs.readdirSync(inboxNewDir)) {
        if (!entry.endsWith('.handoff.dead')) {
            continue;
        }
        const filePath = path.join(inboxNewDir, entry);
        const content = fs.readFileSync(filePath, 'utf-8');
        found.push({
            role,
            filePath,
            from: parseHandoffHeaderField(content, 'from'),
            recipient: parseHandoffHeaderField(content, 'recipient'),
            type: parseHandoffHeaderField(content, 'type'),
            task: parseHandoffHeaderField(content, 'task'),
            chaseCount: readChaseCount(filePath),
        });
    }
    return found;
}
function listDeadLetters(roleInboxes) {
    return roleInboxes.flatMap(({ role, inboxNewDir }) => listDeadLettersForRole(role, inboxNewDir));
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
function readLastChasedAtMs(handoffFilePath) {
    const sc = sidecarPath(handoffFilePath);
    try {
        const data = JSON.parse(fs.readFileSync(sc, 'utf-8'));
        return typeof data.lastChasedAtMs === 'number' ? data.lastChasedAtMs : null;
    }
    catch {
        return null;
    }
}
// BL-135: writeChaseCount also carries the wall-clock time of the chase it
// records, so the next sweep can compute a backoff interval. lastChasedAtMs
// is optional so existing chaseCount-only callers keep working; when
// omitted, any previously-recorded timestamp is preserved rather than lost.
function writeChaseCount(handoffFilePath, count, lastChasedAtMs) {
    const resolvedLastChasedAtMs = lastChasedAtMs ?? readLastChasedAtMs(handoffFilePath);
    const state = { chaseCount: count };
    if (resolvedLastChasedAtMs !== null) {
        state.lastChasedAtMs = resolvedLastChasedAtMs;
    }
    fs.writeFileSync(sidecarPath(handoffFilePath), JSON.stringify(state), 'utf-8');
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
            lastChasedAtMs: readLastChasedAtMs(filePath),
        });
    }
    return items;
}
// BL-135: how long to wait before re-chasing a recipient that is showing
// recent activity (busy, not stuck) — doubles per chase already sent so a
// long-running turn is nudged with growing gaps instead of every sweep tick.
function computeChaseBackoffSeconds(chaseCount, config) {
    const base = config.chaseBackoffBaseSeconds ?? config.chaseIntervalSeconds;
    const max = config.chaseBackoffMaxSeconds ?? config.stuckInProcessTimeoutSeconds;
    return Math.min(base * Math.pow(2, chaseCount), max);
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
function decideItemAction(itemMtimeMs, chaseCount, nowMs, config, liveness, lastActivityMs, lastChasedAtMs = null) {
    const ageSeconds = (nowMs - itemMtimeMs) / 1000;
    if (ageSeconds < config.chaseTimeoutSeconds) {
        return 'skipped';
    }
    const idleSeconds = (nowMs - lastActivityMs) / 1000;
    const hasRecentActivity = idleSeconds < config.stuckInProcessTimeoutSeconds;
    // BL-109: a recipient actively generating for a long turn must never have
    // its own queued mail dead-lettered out from under it - the recipient's
    // own idle-time ready_for_next.sh sees the mail once the turn actually
    // ends. BL-135: but that must not mean hammering the pane with a wake-up
    // on every sweep tick either (98 nudges in ~16min while genuinely busy) -
    // once a chase has already been sent, back off with a growing interval
    // instead of re-chasing on the raw sweep tick.
    if (hasRecentActivity) {
        if (lastChasedAtMs === null) {
            return 'chased';
        }
        const secondsSinceLastChase = (nowMs - lastChasedAtMs) / 1000;
        const backoffSeconds = computeChaseBackoffSeconds(chaseCount, config);
        return secondsSinceLastChase >= backoffSeconds ? 'chased' : 'skipped';
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
function applyInboxItemAction(role, item, action, adapters, nowMs) {
    if (action === 'chased') {
        adapters.sendWakeUp(role);
        writeChaseCount(item.filePath, item.chaseCount + 1, nowMs);
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
        let action = decideItemAction(item.mtimeMs, item.chaseCount, nowMs, config, liveness, lastActivityMs, item.lastChasedAtMs);
        // BL-087: a respawn decision made while still cooling down from the
        // last respawn of this role is downgraded to a chase instead - never
        // silently dropped, so a genuinely still-unresponsive role keeps
        // getting wake-up attempts rather than going quiet.
        if (action === 'respawned' && (0, cooldownScheduler_1.isCoolingDown)(respawnCooldownUntilMs, nowMs)) {
            action = 'chased';
        }
        applyInboxItemAction(role, item, action, adapters, nowMs);
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