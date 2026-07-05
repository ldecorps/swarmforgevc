#!/usr/bin/env node
"use strict";
/**
 * BL-071: agent-callable swarm-metrics CLI.
 *
 * Usage: node swarm-metrics.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout - anchors
 * path resolution at the git worktree/repo root (BL-056 lesson), not raw
 * cwd. Read-only, headless: no VS Code required. Prints a short plain-text
 * overview fed by the SAME computation module the panel uses
 * (metrics/swarmMetrics.ts) - this file is a thin presenter, not a second
 * metrics implementation.
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
exports.hasRolesTsv = hasRolesTsv;
exports.resolveProjectRoot = resolveProjectRoot;
exports.resolveMainWorktreePath = resolveMainWorktreePath;
exports.formatOverview = formatOverview;
exports.loadRoles = loadRoles;
exports.runCliMain = runCliMain;
exports.main = main;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const swarmState_1 = require("../swarm/swarmState");
const runLog_1 = require("../runs/runLog");
const swarmMetrics_1 = require("../metrics/swarmMetrics");
function hasRolesTsv(dir) {
    return fs.existsSync(path.join(dir, '.swarmforge', 'roles.tsv'));
}
function getGitRoot(cwd) {
    try {
        return (0, child_process_1.execFileSync)('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    }
    catch {
        return null;
    }
}
function getGitCommonDir(cwd) {
    try {
        return (0, child_process_1.execFileSync)('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
    }
    catch {
        return null;
    }
}
function resolveProjectRoot(cwd) {
    const gitRoot = getGitRoot(cwd);
    if (gitRoot && hasRolesTsv(gitRoot)) {
        return gitRoot;
    }
    const commonDir = getGitCommonDir(cwd);
    if (commonDir) {
        const candidate = path.dirname(path.resolve(cwd, commonDir));
        if (hasRolesTsv(candidate)) {
            return candidate;
        }
    }
    throw new Error('Cannot resolve SwarmForge project root: no .swarmforge/roles.tsv found via git worktree/repo root.');
}
// Git history for backlog/ is shared across all worktrees, but the panel and
// the CLI must agree on ONE checkout to read active/done state from (BL-071
// scenario-08); other worktrees' backlog/ trees are whatever they last
// merged from main and may be stale. The specifier's (or, absent that, the
// coordinator's) worktree is the master checkout by swarmforge.conf's own
// convention.
function resolveMainWorktreePath(projectRoot, roles) {
    const specifier = roles.find((r) => r.role === 'specifier') ?? roles.find((r) => r.role === 'coordinator');
    return specifier ? specifier.worktreePath : projectRoot;
}
function formatOverview(metrics, roleNames) {
    const meanLine = metrics.meanTicketTimeMs === null
        ? `Mean ticket time: ${swarmMetrics_1.NO_SAMPLE_PLACEHOLDER} (0 tickets)`
        : `Mean ticket time: ${(0, swarmMetrics_1.formatDurationMs)(metrics.meanTicketTimeMs)} over ${metrics.ticketSampleCount} ticket(s)`;
    const busynessLine = 'Busyness: ' + roleNames.map((role) => `${role} ${Math.round((metrics.busyness[role] ?? 0) * 100)}%`).join(', ');
    const worst = Object.entries(metrics.retryByTicket)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    const worstText = worst.length > 0 ? ` (worst: ${worst.map(([id, count]) => `${id} x${count}`).join(', ')})` : '';
    const retryLine = `Retries: ${metrics.retryTotal} total${worstText}`;
    const suite = metrics.suiteDuration;
    const suiteLine = suite.latestMs === null
        ? `Suite duration: ${swarmMetrics_1.NO_SAMPLE_PLACEHOLDER} (0 runs)`
        : `${suite.warn ? 'WARN ' : ''}Suite duration: ${(0, swarmMetrics_1.formatSuiteDurationMs)(suite.latestMs)}` +
            ` (mean ${(0, swarmMetrics_1.formatSuiteDurationMs)(suite.meanMs)} over ${suite.sampleCount} run(s))`;
    return [meanLine, busynessLine, retryLine, suiteLine].join('\n');
}
// Shared by every headless CLI tool under tools/ that keys off roles.tsv
// (swarm-metrics.ts, list-dead-letters.ts): read and parse the current
// project's roles.tsv from its resolved root.
function loadRoles(projectRoot) {
    const rolesTsv = fs.readFileSync(path.join(projectRoot, '.swarmforge', 'roles.tsv'), 'utf8');
    return (0, swarmState_1.parseRolesTsv)(rolesTsv);
}
// Shared `require.main === module` entrypoint boilerplate for tools/ CLIs:
// run main(), and on any thrown error report it and exit non-zero rather
// than dumping a raw stack trace.
function runCliMain(main) {
    try {
        main();
    }
    catch (error) {
        console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
function main() {
    const projectRoot = resolveProjectRoot(process.cwd());
    const roles = loadRoles(projectRoot);
    const mainWorktreePath = resolveMainWorktreePath(projectRoot, roles);
    const runLogPath = path.join(os.homedir(), '.swarmforge', 'runs.jsonl');
    const runs = (0, runLog_1.loadRuns)(runLogPath).filter((r) => r.targetPath === mainWorktreePath);
    runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const runStartMs = runs.length > 0 ? Date.parse(runs[0].startedAt) : null;
    const metrics = (0, swarmMetrics_1.computeSwarmMetrics)(mainWorktreePath, roles, runStartMs);
    console.log(formatOverview(metrics, roles.map((r) => r.role)));
}
if (require.main === module) {
    runCliMain(main);
}
//# sourceMappingURL=swarm-metrics.js.map