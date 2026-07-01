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
exports.generateTraceId = generateTraceId;
exports.isTRACENote = isTRACENote;
exports.createTraceLog = createTraceLog;
exports.appendTraceHop = appendTraceHop;
exports.recordAgentDecision = recordAgentDecision;
exports.recordStateChange = recordStateChange;
exports.recordRetry = recordRetry;
exports.parseTraceLog = parseTraceLog;
exports.parseFullTraceLog = parseFullTraceLog;
exports.computeTraceReport = computeTraceReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const counterMap = new Map();
function generateTraceId() {
    const now = new Date();
    const base = now.getUTCFullYear().toString() +
        String(now.getUTCMonth() + 1).padStart(2, '0') +
        String(now.getUTCDate()).padStart(2, '0') +
        'T' +
        String(now.getUTCHours()).padStart(2, '0') +
        String(now.getUTCMinutes()).padStart(2, '0') +
        String(now.getUTCSeconds()).padStart(2, '0') +
        'z';
    const key = `trace-${base}`;
    const count = counterMap.get(key) ?? 0;
    counterMap.set(key, count + 1);
    return count === 0 ? key : `${key}-${count}`;
}
function isTRACENote(body) {
    return body.startsWith('TRACE ');
}
function createTraceLog(tracesDir, traceId, body) {
    fs.mkdirSync(tracesDir, { recursive: true });
    fs.writeFileSync(path.join(tracesDir, `${traceId}.log`), body + '\n', 'utf-8');
}
function appendTraceHop(tracesDir, traceId, role, action, state) {
    const timestamp = new Date().toISOString();
    let line = `HOP ${role} ${timestamp}`;
    if (action) {
        line += ` action=${action}`;
    }
    if (state) {
        line += ` state=${state}`;
    }
    line += '\n';
    fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}
function recordAgentDecision(tracesDir, traceId, role, decision, details) {
    const timestamp = new Date().toISOString();
    let line = `DECISION ${role} ${timestamp} decision=${decision}`;
    if (details) {
        line += ` details="${details}"`;
    }
    line += '\n';
    fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}
function recordStateChange(tracesDir, traceId, role, fromState, toState, reason) {
    const timestamp = new Date().toISOString();
    let line = `STATE_CHANGE ${role} ${timestamp} ${fromState}->${toState}`;
    if (reason) {
        line += ` reason="${reason}"`;
    }
    line += '\n';
    fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}
function recordRetry(tracesDir, traceId, role, retryCount, reason) {
    const timestamp = new Date().toISOString();
    const line = `RETRY ${role} ${timestamp} attempt=${retryCount} reason="${reason}"\n`;
    fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}
function parseTraceLog(content) {
    const hops = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // Match "TRACE <id> HOP <role> <timestamp>" or "HOP <role> <timestamp>"
        const traceMatch = trimmed.match(/^TRACE\s+\S+\s+HOP\s+(\S+)\s+(\S+)/);
        const hopMatch = trimmed.match(/^HOP\s+(\S+)\s+(\S+)(.*)/);
        const m = traceMatch ?? hopMatch;
        if (!m) {
            continue;
        }
        const ts = new Date(m[2]);
        if (isNaN(ts.getTime())) {
            continue;
        }
        const hop = { role: m[1], timestamp: ts };
        // Parse optional action and state from the line
        if (m[3]) {
            const actionMatch = m[3].match(/action=(\S+)/);
            const stateMatch = m[3].match(/state=(\S+)/);
            if (actionMatch) {
                hop.action = actionMatch[1];
            }
            if (stateMatch) {
                hop.state = stateMatch[1];
            }
        }
        hops.push(hop);
    }
    return hops;
}
function parseFullTraceLog(content) {
    const hops = [];
    const decisions = [];
    const stateChanges = [];
    const retries = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // HOP entries
        const hopMatch = trimmed.match(/^(?:TRACE\s+\S+\s+)?HOP\s+(\S+)\s+(\S+)(.*)/);
        if (hopMatch) {
            const ts = new Date(hopMatch[2]);
            if (!isNaN(ts.getTime())) {
                const hop = { role: hopMatch[1], timestamp: ts };
                if (hopMatch[3]) {
                    const actionMatch = hopMatch[3].match(/action=(\S+)/);
                    const stateMatch = hopMatch[3].match(/state=(\S+)/);
                    if (actionMatch) {
                        hop.action = actionMatch[1];
                    }
                    if (stateMatch) {
                        hop.state = stateMatch[1];
                    }
                }
                hops.push(hop);
            }
            continue;
        }
        // DECISION entries
        const decisionMatch = trimmed.match(/^DECISION\s+(\S+)\s+(\S+)\s+decision=(\S+)(.*)/);
        if (decisionMatch) {
            const ts = new Date(decisionMatch[2]);
            if (!isNaN(ts.getTime())) {
                const detailsMatch = decisionMatch[4].match(/details="([^"]*)"/);
                decisions.push({
                    role: decisionMatch[1],
                    timestamp: ts,
                    decision: decisionMatch[3],
                    details: detailsMatch?.[1],
                });
            }
            continue;
        }
        // STATE_CHANGE entries
        const stateChangeMatch = trimmed.match(/^STATE_CHANGE\s+(\S+)\s+(\S+)\s+(\S+)->(\S+)(.*)/);
        if (stateChangeMatch) {
            const ts = new Date(stateChangeMatch[2]);
            if (!isNaN(ts.getTime())) {
                const reasonMatch = stateChangeMatch[5].match(/reason="([^"]*)"/);
                stateChanges.push({
                    role: stateChangeMatch[1],
                    timestamp: ts,
                    from: stateChangeMatch[3],
                    to: stateChangeMatch[4],
                    reason: reasonMatch?.[1],
                });
            }
            continue;
        }
        // RETRY entries
        const retryMatch = trimmed.match(/^RETRY\s+(\S+)\s+(\S+)\s+attempt=(\d+)\s+reason="([^"]*)"/);
        if (retryMatch) {
            const ts = new Date(retryMatch[2]);
            if (!isNaN(ts.getTime())) {
                retries.push({
                    role: retryMatch[1],
                    timestamp: ts,
                    attempt: parseInt(retryMatch[3], 10),
                    reason: retryMatch[4],
                });
            }
            continue;
        }
    }
    return { hops, decisions, stateChanges, retries };
}
function computeTraceReport(hops, traceId, decisions, stateChanges, retries) {
    if (hops.length === 0) {
        return {
            pass: false,
            traceId: traceId || 'unknown',
            lastHop: null,
            totalDuration: 0,
            hops: [],
            transitions: [],
        };
    }
    const lastHop = hops[hops.length - 1].role;
    const pass = lastHop === 'cleaner';
    const firstTimestamp = hops[0].timestamp;
    const lastTimestamp = hops[hops.length - 1].timestamp;
    const totalDuration = (lastTimestamp.getTime() - firstTimestamp.getTime()) / 1000;
    const hopsWithDuration = hops.map((hop, i) => ({
        role: hop.role,
        timestamp: hop.timestamp.toISOString(),
        action: hop.action,
        state: hop.state,
        duration: i < hops.length - 1
            ? (hops[i + 1].timestamp.getTime() - hop.timestamp.getTime()) / 1000
            : 0,
    }));
    const transitions = [];
    for (let i = 1; i < hops.length; i++) {
        const seconds = (hops[i].timestamp.getTime() - hops[i - 1].timestamp.getTime()) / 1000;
        transitions.push({ from: hops[i - 1].role, to: hops[i].role, seconds });
    }
    return {
        pass,
        traceId: traceId || 'unknown',
        lastHop,
        totalDuration,
        hops: hopsWithDuration,
        transitions,
    };
}
//# sourceMappingURL=tracer.js.map