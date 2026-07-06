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
exports.buildRoleInboxes = buildRoleInboxes;
exports.startChaserMonitor = startChaserMonitor;
exports.stopChaserMonitor = stopChaserMonitor;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const inboxChaser_1 = require("../swarm/inboxChaser");
const handoffRecovery_1 = require("../swarm/handoffRecovery");
const swarmState_1 = require("../swarm/swarmState");
// Handoff inboxes live per WORKTREE (from roles.tsv), not under a per-role
// <target>/.swarmforge/handoffs/<role>/ layout — the monitor previously built
// the latter, which does not exist, so the live sweep scanned empty paths and
// never chased anything (BL-067 root cause 2).
function buildRoleInboxes(targetPath, rolesList) {
    const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
    let entries;
    try {
        entries = (0, swarmState_1.parseRolesTsv)(fs.readFileSync(rolesFile, 'utf8'));
    }
    catch {
        return [];
    }
    return entries
        .filter((entry) => rolesList.includes(entry.role))
        .map((entry) => {
        const inbox = path.join(entry.worktreePath, '.swarmforge', 'handoffs', 'inbox');
        return {
            role: entry.role,
            inboxNewDir: path.join(inbox, 'new'),
            inProcessDir: path.join(inbox, 'in_process'),
        };
    });
}
function startChaserMonitor(config, callbacks) {
    const swarmforgeDir = path.join(config.targetPath, '.swarmforge');
    if (!fs.existsSync(swarmforgeDir)) {
        return null;
    }
    const adapters = {
        getLiveness: callbacks.getLiveness,
        sendWakeUp: callbacks.sendWakeUp,
        triggerRespawn: callbacks.triggerRespawn,
        logDeadLetter: callbacks.logDeadLetter,
        getLastActivityMs: callbacks.getLastActivityMs,
        onStuckEscalation: callbacks.onStuckEscalation,
    };
    const roleInboxes = buildRoleInboxes(config.targetPath, config.rolesList);
    // BL-122: the recovery owner is this SAME extension-host timer, not any
    // one pipeline agent — an agent process exiting can tear the swarm down
    // around it (BL-107), but this watchdog is already the supervised owner
    // of the chase/respawn seams recovery builds on.
    const runRecoverySweep = () => {
        (0, handoffRecovery_1.recoverDeadLetters)(roleInboxes, { maxRecoveryAttempts: config.maxRecoveryAttempts }, {
            isRecipientBusy: (role) => {
                const inbox = roleInboxes.find((r) => r.role === role);
                return inbox ? (0, inboxChaser_1.scanInProcess)(inbox.inProcessDir).length > 0 : false;
            },
            sendWakeUp: callbacks.sendWakeUp,
            logRemediation: (outcome) => (0, handoffRecovery_1.appendRecoveryLog)(config.targetPath, outcome),
            setNeedsHuman: callbacks.onStuckEscalation,
        });
    };
    // Start periodic sweep
    const intervalId = setInterval(() => {
        const nowMs = Date.now();
        (0, inboxChaser_1.runSweep)(roleInboxes, nowMs, config, adapters);
        runRecoverySweep();
    }, config.chaseIntervalSeconds * 1000);
    return intervalId;
}
function stopChaserMonitor(intervalId) {
    if (intervalId) {
        clearInterval(intervalId);
    }
}
//# sourceMappingURL=chaserMonitor.js.map