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
exports.appendEventRaw = appendEventRaw;
exports.readLog = readLog;
exports.currentStatus = currentStatus;
exports.createMessage = createMessage;
exports.claimMessage = claimMessage;
exports.completeMessage = completeMessage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const atomicWrite_1 = require("../util/atomicWrite");
/** Atomically append one JSON line to logPath. */
function appendEventRaw(logPath, event) {
    (0, atomicWrite_1.atomicAppend)(logPath, JSON.stringify(event) + '\n');
}
/** Parse all events from a log file, skipping partial or malformed lines. */
function readLog(logPath) {
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const events = [];
        for (const line of content.split('\n')) {
            if (!line.trim())
                continue;
            try {
                events.push(JSON.parse(line));
            }
            catch {
                // skip partial/malformed lines
            }
        }
        return events;
    }
    catch {
        return [];
    }
}
/** Return the last event of a given type, or undefined if not found. */
function findLastEventOfType(events, type) {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === type)
            return events[i];
    }
    return undefined;
}
/** Return the type of the last event (current status). */
function currentStatus(logPath) {
    const events = readLog(logPath);
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    return lastEvent?.type;
}
/**
 * Create a new message in dir. Returns the message id (also the filename stem).
 * Writes a `created` event atomically.
 */
function createMessage(dir, opts) {
    const at = new Date().toISOString();
    const id = `${Date.now()}-${opts.seq}-${crypto.randomBytes(4).toString('hex')}`;
    const logPath = path.join(dir, `${id}.log`);
    const event = {
        type: 'created',
        id,
        seq: opts.seq,
        schema: 1,
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        at,
    };
    appendEventRaw(logPath, event);
    return id;
}
/**
 * Attempt to claim a message for `by`. Returns true if claimed (or already
 * held by `by` with a live lease). Returns false if another claimer holds a
 * live lease.
 */
function claimMessage(logPath, by, nowEpoch, leaseTtlSeconds) {
    const events = readLog(logPath);
    const lastReceived = findLastEventOfType(events, 'received');
    if (lastReceived) {
        const claimed = lastReceived.claimed_by;
        if (claimed) {
            const parts = claimed.split('@');
            if (parts.length === 2) {
                const leaseEpoch = parseInt(parts[1], 10);
                if (!isNaN(leaseEpoch) && nowEpoch - leaseEpoch < leaseTtlSeconds) {
                    const claimer = parts[0];
                    if (claimer === by)
                        return true; // idempotent
                    return false; // different claimer holds live lease
                }
                // NaN or expired lease — fall through to re-claim
            }
        }
    }
    const status = events.length > 0 ? events[events.length - 1].type : undefined;
    if (status === 'done')
        return false;
    const at = new Date().toISOString();
    appendEventRaw(logPath, {
        type: 'received',
        by,
        at,
        claimed_by: `${by}@${nowEpoch}`,
    });
    return true;
}
/**
 * Mark a message done. Appends a `done` event.
 */
function completeMessage(logPath, by) {
    appendEventRaw(logPath, {
        type: 'done',
        by,
        at: new Date().toISOString(),
    });
}
//# sourceMappingURL=messageBus.js.map