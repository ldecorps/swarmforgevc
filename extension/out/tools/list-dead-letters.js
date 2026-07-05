#!/usr/bin/env node
"use strict";
/**
 * BL-109 dead-letter-visible-03: agent/human-callable dead-letter listing.
 *
 * Usage: node list-dead-letters.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout - anchors
 * path resolution at the git worktree/repo root (BL-056 lesson), reusing
 * swarm-metrics.ts's resolveProjectRoot. Read-only, headless: no VS Code
 * required. A dead-lettered handoff was previously invisible debris (renamed
 * to <name>.handoff.dead next to a .chase.json sidecar nothing read back,
 * indistinguishable from success to the sender); this surfaces every one,
 * across every role, with who it was for and what it was.
 */
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
exports.formatDeadLetterListing = formatDeadLetterListing;
exports.main = main;
const path = __importStar(require("path"));
const inboxChaser_1 = require("../swarm/inboxChaser");
const swarm_metrics_1 = require("./swarm-metrics");
function formatDeadLetterListing(deadLetters) {
    if (deadLetters.length === 0) {
        return 'No dead-lettered handoffs.';
    }
    return deadLetters
        .map((d) => {
        const from = d.from ?? 'unknown';
        const type = d.type ?? 'unknown';
        const task = d.task ? ` task=${d.task}` : '';
        return `[${d.role}] ${path.basename(d.filePath)} - from=${from} type=${type}${task} chases=${d.chaseCount}`;
    })
        .join('\n');
}
function main() {
    const projectRoot = (0, swarm_metrics_1.resolveProjectRoot)(process.cwd());
    const roles = (0, swarm_metrics_1.loadRoles)(projectRoot);
    const roleInboxes = roles.map((r) => ({
        role: r.role,
        inboxNewDir: path.join(r.worktreePath, '.swarmforge', 'handoffs', 'inbox', 'new'),
    }));
    console.log(formatDeadLetterListing((0, inboxChaser_1.listDeadLetters)(roleInboxes)));
}
if (require.main === module) {
    (0, swarm_metrics_1.runCliMain)(main);
}
//# sourceMappingURL=list-dead-letters.js.map