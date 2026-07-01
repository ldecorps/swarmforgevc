#!/usr/bin/env node
"use strict";
/**
 * BL-021: trace-hop CLI
 *
 * Usage:
 *   node trace-hop.js <traceId> receive
 *   node trace-hop.js <traceId> decide <decision> [detail]
 *   node trace-hop.js <traceId> retry "<reason>"
 *
 * Role is read from $SWARMFORGE_ROLE.
 * Traces dir: $SWARMFORGE_TRACES_DIR or <git-common-dir>/../.swarmforge/traces/
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
exports.PHASE_MAP = void 0;
exports.roleToPhase = roleToPhase;
exports.buildReceiveLines = buildReceiveLines;
exports.buildDecideLines = buildDecideLines;
exports.buildRetryLine = buildRetryLine;
exports.countPriorRetries = countPriorRetries;
exports.resolveTracesDir = resolveTracesDir;
exports.main = main;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
exports.PHASE_MAP = {
    coordinator: 'routing',
    specifier: 'specifying',
    coder: 'coding',
    cleaner: 'verifying',
    QA: 'qa-verifying',
};
function roleToPhase(role) {
    const phase = exports.PHASE_MAP[role];
    if (!phase) {
        throw new Error(`Unknown role "${role}" — cannot map to phase. Known roles: ${Object.keys(exports.PHASE_MAP).join(', ')}`);
    }
    return phase;
}
function buildReceiveLines(role, iso) {
    const phase = roleToPhase(role);
    return [
        `HOP ${role} ${iso} action=receive state=received`,
        `STATE_CHANGE ${role} ${iso} received->${phase}`,
    ];
}
function buildDecideLines(role, iso, decision, detail) {
    let line = `DECISION ${role} ${iso} decision=${decision}`;
    if (detail) {
        line += ` details="${detail}"`;
    }
    return [line];
}
function buildRetryLine(role, iso, attempt, reason) {
    return `RETRY ${role} ${iso} attempt=${attempt} reason="${reason}"`;
}
function countPriorRetries(logPath, role) {
    if (!fs.existsSync(logPath)) {
        return 0;
    }
    try {
        const content = fs.readFileSync(logPath, 'utf-8');
        let count = 0;
        // Escape role for regex: role is a fixed constant (coordinator/specifier/coder/cleaner)
        // but defensive escaping prevents logic errors if that changes.
        const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^RETRY ${escapedRole} `);
        for (const line of content.split('\n')) {
            if (line.match(pattern)) {
                count++;
            }
        }
        return count;
    }
    catch (error) {
        console.error(`Cannot read log file ${logPath}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}
function resolveTracesDir(envDir, cwd) {
    if (envDir) {
        return envDir;
    }
    try {
        const gitCommonDir = (0, child_process_1.execSync)('git rev-parse --git-common-dir', {
            cwd: cwd ?? process.cwd(),
            encoding: 'utf-8',
        }).trim();
        // git-common-dir is inside the worktree; go up to the repo root
        const repoRoot = path.resolve(gitCommonDir, '..', '..');
        return path.join(repoRoot, '.swarmforge', 'traces');
    }
    catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot resolve traces directory: $SWARMFORGE_TRACES_DIR is not set and git rev-parse --git-common-dir failed. Details: ${details}`);
    }
}
function atomicAppend(logPath, lines) {
    // Use O_APPEND for all appends (atomic on POSIX). This avoids the race condition
    // of multi-line appends where concurrent writers can lose data via rename.
    const content = lines.join('\n') + '\n';
    try {
        fs.appendFileSync(logPath, content, { encoding: 'utf-8', flag: 'a' });
    }
    catch (error) {
        throw new Error(`Failed to append to trace log ${logPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function main(argv) {
    try {
        const role = process.env.SWARMFORGE_ROLE;
        if (!role) {
            console.error('ERROR: $SWARMFORGE_ROLE is not set.');
            process.exit(1);
        }
        const [traceId, command, ...rest] = argv;
        if (!traceId || !command) {
            console.error('Usage: trace-hop.js <traceId> <receive|decide|retry> [args...]');
            process.exit(1);
        }
        // Validate traceId: must not contain path separators or traversal patterns
        if (traceId.includes('/') || traceId.includes('\\') || traceId.includes('..')) {
            console.error(`ERROR: Invalid traceId "${traceId}" — must not contain path separators or traversal patterns.`);
            process.exit(1);
        }
        const tracesDir = resolveTracesDir(process.env.SWARMFORGE_TRACES_DIR ?? null);
        fs.mkdirSync(tracesDir, { recursive: true });
        const logPath = path.join(tracesDir, `${traceId}.log`);
        const iso = new Date().toISOString();
        if (command === 'receive') {
            atomicAppend(logPath, buildReceiveLines(role, iso));
        }
        else if (command === 'decide') {
            const [decision, detail] = rest;
            if (!decision) {
                console.error('Usage: trace-hop.js <traceId> decide <decision> [detail]');
                process.exit(1);
            }
            atomicAppend(logPath, buildDecideLines(role, iso, decision, detail));
        }
        else if (command === 'retry') {
            const reason = rest[0];
            if (!reason) {
                console.error('Usage: trace-hop.js <traceId> retry "<reason>"');
                process.exit(1);
            }
            const attempt = countPriorRetries(logPath, role) + 1;
            atomicAppend(logPath, [buildRetryLine(role, iso, attempt, reason)]);
        }
        else {
            console.error(`Unknown command "${command}". Expected: receive, decide, retry.`);
            process.exit(1);
        }
    }
    catch (error) {
        console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
if (require.main === module) {
    main(process.argv.slice(2));
}
//# sourceMappingURL=trace-hop.js.map