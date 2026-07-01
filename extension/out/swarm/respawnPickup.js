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
exports.pickupPendingMessages = pickupPendingMessages;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const messageBus_1 = require("./messageBus");
function isEligible(events, nowEpoch, leaseTtlSeconds) {
    if (events.length === 0)
        return false;
    const last = events[events.length - 1];
    const status = last.type;
    if (status === 'done' || status === 'dead-letter')
        return false;
    if (status === 'created' || status === 'chased')
        return true;
    if (status === 'received') {
        const claimed = last.claimed_by;
        if (!claimed)
            return true;
        const parts = claimed.split('@');
        if (parts.length !== 2)
            return true;
        const leaseEpoch = parseInt(parts[1], 10);
        if (isNaN(leaseEpoch))
            return true;
        return nowEpoch - leaseEpoch >= leaseTtlSeconds;
    }
    return false;
}
/**
 * Scan dir for message logs addressed to role that are claimable.
 * Each returned message has been atomically claimed via claimMessage.
 */
function pickupPendingMessages(dir, role, nowEpoch, leaseTtlSeconds) {
    let files;
    try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
    }
    catch {
        return [];
    }
    const results = [];
    for (const file of files) {
        const logPath = path.join(dir, file);
        const events = (0, messageBus_1.readLog)(logPath);
        if (events.length === 0)
            continue;
        const created = events[0];
        if (created.type !== 'created')
            continue;
        if (created.to !== role)
            continue;
        if (!isEligible(events, nowEpoch, leaseTtlSeconds))
            continue;
        // Atomically claim before including in results
        const claimed = (0, messageBus_1.claimMessage)(logPath, role, nowEpoch, leaseTtlSeconds);
        if (!claimed)
            continue;
        const id = file.replace(/\.log$/, '');
        results.push({ id, logPath, status: 'received', body: created.body });
    }
    return results;
}
//# sourceMappingURL=respawnPickup.js.map