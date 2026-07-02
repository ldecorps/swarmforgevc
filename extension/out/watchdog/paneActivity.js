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
exports.trackPaneActivity = trackPaneActivity;
exports.resetPaneActivity = resetPaneActivity;
exports.outboxNewestMtimeMs = outboxNewestMtimeMs;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const swarmState_1 = require("../swarm/swarmState");
const records = new Map();
function trackPaneActivity(role, paneContent, outboxActivityMs, nowMs) {
    const hash = crypto.createHash('sha1').update(paneContent).digest('hex');
    const previous = records.get(role);
    if (!previous || previous.hash !== hash) {
        // First observation also counts as activity: never chase a role the
        // monitor has not watched for a full quiet threshold yet.
        records.set(role, { hash, lastChangeMs: nowMs });
        return nowMs;
    }
    return Math.max(previous.lastChangeMs, outboxActivityMs);
}
function resetPaneActivity() {
    records.clear();
}
// Newest write under the role's outbox/sent dirs. The daemon's pickup happens
// within a poll cycle of the agent's write, so the directory mtimes track
// agent send activity closely enough for a minutes-scale stuck threshold.
function outboxNewestMtimeMs(targetPath, role) {
    try {
        const tsv = fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8');
        const entry = (0, swarmState_1.parseRolesTsv)(tsv).find((r) => r.role === role);
        if (!entry)
            return 0;
        const handoffs = path.join(entry.worktreePath, '.swarmforge', 'handoffs');
        return Math.max(0, ...['outbox', 'sent'].map((dir) => {
            try {
                return fs.statSync(path.join(handoffs, dir)).mtimeMs;
            }
            catch {
                return 0;
            }
        }));
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=paneActivity.js.map