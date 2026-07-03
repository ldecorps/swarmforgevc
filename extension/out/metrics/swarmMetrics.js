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
exports.NO_SAMPLE_PLACEHOLDER = void 0;
exports.computeMeanTicketTime = computeMeanTicketTime;
exports.computeBusyness = computeBusyness;
exports.computeRetries = computeRetries;
exports.formatDurationMs = formatDurationMs;
exports.computeSwarmMetrics = computeSwarmMetrics;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
// The forward pipeline chain (PIPELINE.md). The coordinator sits outside it
// and is never a retry participant.
const PIPELINE_ORDER = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
function pipelineIndex(role) {
    return PIPELINE_ORDER.indexOf(role);
}
function listFilesInDoneDir(doneDir, subdir) {
    const fullPath = path.join(doneDir, subdir);
    let entries;
    try {
        entries = fs.readdirSync(fullPath).filter((f) => f.endsWith('.yaml'));
    }
    catch {
        return [];
    }
    return entries.map((f) => path.join('backlog', 'done', subdir, f));
}
function listDoneBacklogPaths(targetPath) {
    const doneDir = path.join(targetPath, 'backlog', 'done');
    let entries;
    try {
        entries = fs.readdirSync(doneDir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const paths = [];
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.yaml')) {
            paths.push(path.join('backlog', 'done', entry.name));
        }
        else if (entry.isDirectory()) {
            paths.push(...listFilesInDoneDir(doneDir, entry.name));
        }
    }
    return paths;
}
function parseGitBlocks(output) {
    const blocks = [];
    let current = null;
    for (const line of output.split('\n')) {
        if (line.startsWith('COMMIT\t')) {
            current = { dateIso: line.split('\t')[1], statusLines: [] };
            blocks.push(current);
        }
        else if (current && line.trim()) {
            current.statusLines.push(line);
        }
    }
    return blocks;
}
function gitFollowHistory(targetPath, relativePath) {
    let output;
    try {
        output = (0, child_process_1.execFileSync)('git', ['-C', targetPath, 'log', '--follow', '--name-status', '--format=COMMIT%x09%cI', '--', relativePath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    }
    catch {
        return [];
    }
    return parseGitBlocks(output);
}
function findArrivalDate(blocks, matchesPath) {
    for (const block of blocks) {
        const arrived = block.statusLines.some((line) => {
            const cols = line.split('\t');
            const status = cols[0];
            const newPath = cols[cols.length - 1];
            return (status.startsWith('R') || status === 'A') && matchesPath(newPath);
        });
        if (arrived) {
            return new Date(block.dateIso);
        }
    }
    return null;
}
function getTicketDuration(blocks, donePath) {
    const posixDonePath = donePath.split(path.sep).join('/');
    const closedAt = findArrivalDate(blocks, (p) => p === posixDonePath);
    const activatedAt = findArrivalDate(blocks, (p) => p.startsWith('backlog/active/'));
    if (!closedAt || !activatedAt) {
        return null;
    }
    const durationMs = closedAt.getTime() - activatedAt.getTime();
    return durationMs > 0 ? durationMs : null;
}
// Derives a ticket's active -> done duration purely from git's own rename
// tracking on the backlog file's path history, rather than parsing commit
// message wording (which is a convention, not a protocol contract).
function computeMeanTicketTime(targetPath) {
    const donePaths = listDoneBacklogPaths(targetPath);
    const durationsMs = [];
    for (const donePath of donePaths) {
        const blocks = gitFollowHistory(targetPath, donePath);
        if (blocks.length === 0) {
            continue;
        }
        const duration = getTicketDuration(blocks, donePath);
        if (duration !== null) {
            durationsMs.push(duration);
        }
    }
    if (durationsMs.length === 0) {
        return { meanMs: null, sampleCount: 0 };
    }
    const total = durationsMs.reduce((sum, d) => sum + d, 0);
    return { meanMs: total / durationsMs.length, sampleCount: durationsMs.length };
}
function parseHandoffHeaders(content) {
    const header = content.split('\n\n')[0];
    const headers = {};
    for (const line of header.split('\n')) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
            headers[match[1]] = match[2].trim();
        }
    }
    return headers;
}
function readHandoffFiles(dir) {
    try {
        return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
    }
    catch {
        return [];
    }
}
function intervalMs(start, end) {
    return !Number.isNaN(start) && !Number.isNaN(end) && end > start ? end - start : 0;
}
function sumCompletedIntervalsMs(completedDir) {
    let totalMs = 0;
    for (const file of readHandoffFiles(completedDir)) {
        let headers;
        try {
            headers = parseHandoffHeaders(fs.readFileSync(path.join(completedDir, file), 'utf8'));
        }
        catch {
            continue;
        }
        const start = headers.dequeued_at ? Date.parse(headers.dequeued_at) : NaN;
        const end = headers.completed_at ? Date.parse(headers.completed_at) : NaN;
        totalMs += intervalMs(start, end);
    }
    return totalMs;
}
function findEarliestDequeueInFile(filePath, current) {
    let headers;
    try {
        headers = parseHandoffHeaders(fs.readFileSync(filePath, 'utf8'));
    }
    catch {
        return current;
    }
    const dequeuedMs = headers.dequeued_at ? Date.parse(headers.dequeued_at) : NaN;
    if (Number.isNaN(dequeuedMs)) {
        return current;
    }
    return current === null || dequeuedMs < current ? dequeuedMs : current;
}
function collectHandoffFilesAt(fullPath, entry) {
    let stat;
    try {
        stat = fs.statSync(fullPath);
    }
    catch {
        return [];
    }
    if (stat.isDirectory()) {
        return readHandoffFiles(fullPath).map((f) => path.join(fullPath, f));
    }
    return entry.endsWith('.handoff') ? [fullPath] : [];
}
function findEarliestDequeueInDir(inProcessDir) {
    let entries;
    try {
        entries = fs.readdirSync(inProcessDir);
    }
    catch {
        return null;
    }
    let earliest = null;
    for (const entry of entries) {
        const fullPath = path.join(inProcessDir, entry);
        for (const filePath of collectHandoffFilesAt(fullPath, entry)) {
            earliest = findEarliestDequeueInFile(filePath, earliest);
        }
    }
    return earliest;
}
function openIntervalMs(inProcessDir, nowMs) {
    const earliestDequeueMs = findEarliestDequeueInDir(inProcessDir);
    return earliestDequeueMs === null ? 0 : Math.max(0, nowMs - earliestDequeueMs);
}
// Fraction (0..1) of the run's elapsed time each role's inbox was occupied:
// completed [dequeued_at, completed_at] intervals plus any still-open
// in_process interval.
function computeBusyness(roles, runStartMs, nowMs) {
    const elapsedMs = Math.max(1, nowMs - runStartMs);
    const busyness = {};
    for (const role of roles) {
        const completedDir = path.join(role.worktreePath, '.swarmforge', 'handoffs', 'inbox', 'completed');
        const inProcessDir = path.join(role.worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
        const occupiedMs = sumCompletedIntervalsMs(completedDir) + openIntervalMs(inProcessDir, nowMs);
        busyness[role.role] = Math.min(1, occupiedMs / elapsedMs);
    }
    return busyness;
}
function extractTicketId(task) {
    const match = task.match(/^([A-Za-z]+-\d+)/);
    return match ? match[1] : null;
}
function isGitHandoff(headers) {
    return headers.type === 'git_handoff';
}
function getRecipients(toField) {
    return (toField ?? '').split(',').map((r) => r.trim()).filter(Boolean);
}
function isBackwardRecipient(fromIdx, recipient) {
    const toIdx = pipelineIndex(recipient);
    return toIdx !== -1 && fromIdx > toIdx;
}
function ticketFromHeaders(headers) {
    return headers.task ? extractTicketId(headers.task) : null;
}
function countBackwardHandoffs(headers) {
    if (!isGitHandoff(headers)) {
        return [];
    }
    const fromIdx = pipelineIndex(headers.from ?? '');
    if (fromIdx === -1) {
        return [];
    }
    const ticket = ticketFromHeaders(headers);
    return getRecipients(headers.to)
        .filter((recipient) => isBackwardRecipient(fromIdx, recipient))
        .map(() => ({ ticket }));
}
// Counts git_handoff files whose sender sits later in the pipeline chain
// than the recipient. Scans each role's sent/ (the delivered original, one
// copy regardless of recipient count) rather than inbox/completed copies,
// so a broadcast is not double-counted per recipient.
function processSentFile(sentDir, file, perTicket) {
    let headers;
    try {
        headers = parseHandoffHeaders(fs.readFileSync(path.join(sentDir, file), 'utf8'));
    }
    catch {
        return 0;
    }
    const backwardHandoffs = countBackwardHandoffs(headers);
    for (const handoff of backwardHandoffs) {
        if (handoff.ticket) {
            perTicket[handoff.ticket] = (perTicket[handoff.ticket] ?? 0) + 1;
        }
    }
    return backwardHandoffs.length;
}
function computeRetries(roles) {
    let total = 0;
    const perTicket = {};
    for (const role of roles) {
        const sentDir = path.join(role.worktreePath, '.swarmforge', 'handoffs', 'sent');
        for (const file of readHandoffFiles(sentDir)) {
            total += processSentFile(sentDir, file, perTicket);
        }
    }
    return { total, perTicket };
}
exports.NO_SAMPLE_PLACEHOLDER = '—';
function formatDurationMs(ms) {
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}
function computeSwarmMetrics(targetPath, roles, runStartMs, nowMs = Date.now()) {
    const { meanMs, sampleCount } = computeMeanTicketTime(targetPath);
    const busyness = runStartMs !== null
        ? computeBusyness(roles, runStartMs, nowMs)
        : Object.fromEntries(roles.map((r) => [r.role, 0]));
    const { total, perTicket } = computeRetries(roles);
    return {
        meanTicketTimeMs: meanMs,
        ticketSampleCount: sampleCount,
        busyness,
        retryTotal: total,
        retryByTicket: perTicket,
    };
}
//# sourceMappingURL=swarmMetrics.js.map