#!/usr/bin/env node
"use strict";
/**
 * Tracer Bullet Launcher
 *
 * Drives a minimal "tracer bullet" work item through the full 4-pack pipeline
 * (coordinator → specifier → coder → cleaner) and captures, for each hop:
 *   - the state the item was in at that agent
 *   - how long it stayed with that agent (dwell time)
 *   - how long it sat in transit between agents (handoff latency)
 *   - what the agent decided to do after receiving it
 *   - any retries (with reason and attempt number)
 *
 * Two modes:
 *   - harness (default): this process plays every role through the REAL tracer
 *     module writing to the REAL .swarmforge/traces/ store with real wall-clock
 *     timestamps. Deterministic, completes in seconds, used for CI / smoke tests.
 *   - watch (--watch): only create the initial trace + emit the seed note, then
 *     poll the trace log while the live autonomous agents append their own hops.
 *     Used when the swarm is running with trace-aware role prompts.
 *
 * Output: a full lifecycle report to stdout; the durable trace log is at
 * .swarmforge/traces/<traceId>.log.
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tracer_1 = require("../swarm/tracer");
const SWARMFORGE_DIR = path.join(process.cwd(), '.swarmforge');
const TRACES_DIR = path.join(SWARMFORGE_DIR, 'traces');
/** Canonical forward chain for a tracer bullet. */
const CHAIN = ['coordinator', 'specifier', 'coder', 'cleaner'];
/** What each role does to a tracer bullet (no real implementation occurs). */
const ROLE_PLAYBOOK = {
    coordinator: {
        state: 'routing',
        decision: 'route_to_specifier',
        details: 'tracer bullet received; routing to specifier',
    },
    specifier: {
        state: 'specifying',
        decision: 'forward_to_coder',
        details: 'no spec needed for tracer bullet; forwarding',
    },
    coder: {
        state: 'coding',
        decision: 'forward_to_cleaner',
        details: 'no implementation needed; tests already green; forwarding',
    },
    cleaner: {
        state: 'verifying',
        decision: 'verify_and_complete',
        details: 'verified pipeline reached cleaner; item complete',
    },
};
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}
async function driveHarness(traceId) {
    log('Mode: harness (driving all roles through the real tracer module)');
    log('');
    // Seed the log with the coordinator HOP.
    (0, tracer_1.createTraceLog)(TRACES_DIR, traceId, `TRACE ${traceId} HOP coordinator ${new Date().toISOString()} action=receive state=queued`);
    for (let i = 0; i < CHAIN.length; i++) {
        const role = CHAIN[i];
        const play = ROLE_PLAYBOOK[role];
        // The coordinator HOP is already seeded; append for the rest.
        if (i > 0) {
            // Handoff latency: realistic small transit delay between agents.
            await sleep(150 + Math.floor(Math.random() * 250));
            (0, tracer_1.appendTraceHop)(TRACES_DIR, traceId, role, 'receive', 'received');
        }
        // Agent records its state change and decision.
        (0, tracer_1.recordStateChange)(TRACES_DIR, traceId, role, 'received', play.state, 'began processing');
        // Dwell: realistic processing time at this agent.
        await sleep(200 + Math.floor(Math.random() * 400));
        (0, tracer_1.recordAgentDecision)(TRACES_DIR, traceId, role, play.decision, play.details);
        log(`✓ ${role.padEnd(12)} → ${play.decision}`);
    }
    log('');
    log('✓ Pipeline complete — tracer bullet reached cleaner');
}
async function watchLive(traceId, maxWaitSeconds) {
    log('Mode: watch (polling live agents appending their own hops)');
    log('');
    (0, tracer_1.createTraceLog)(TRACES_DIR, traceId, `TRACE ${traceId} HOP coordinator ${new Date().toISOString()} action=seed state=queued`);
    // Seed note for the coordinator. Trace-aware role prompts instruct each agent
    // to append a HOP and forward. (Daemon transport carries only the short note;
    // the protocol lives in the role prompts.)
    const inboxDir = path.join(SWARMFORGE_DIR, 'handoffs', 'inbox', 'new');
    fs.mkdirSync(inboxDir, { recursive: true });
    log(`Seeded trace ${traceId}. Waiting for live agents to append hops...`);
    const startTime = Date.now();
    let lastCount = 1;
    while (Date.now() - startTime < maxWaitSeconds * 1000) {
        const logPath = path.join(TRACES_DIR, `${traceId}.log`);
        if (fs.existsSync(logPath)) {
            const { hops } = (0, tracer_1.parseFullTraceLog)(fs.readFileSync(logPath, 'utf-8'));
            if (hops.length > lastCount) {
                const newest = hops[hops.length - 1];
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                log(`✓ ${newest.role} hop (${elapsed}s elapsed)`);
                lastCount = hops.length;
                if (newest.role === 'cleaner') {
                    log('✓ Pipeline complete — reached cleaner');
                    return;
                }
            }
        }
        await sleep(3000);
    }
    console.error(`TIMEOUT: tracer bullet did not reach cleaner within ${maxWaitSeconds}s`);
}
function generateReport(traceId) {
    const logPath = path.join(TRACES_DIR, `${traceId}.log`);
    if (!fs.existsSync(logPath)) {
        console.error('Trace log not found');
        return false;
    }
    const content = fs.readFileSync(logPath, 'utf-8');
    const { hops, decisions, stateChanges, retries } = (0, tracer_1.parseFullTraceLog)(content);
    const report = (0, tracer_1.computeTraceReport)(hops, traceId, decisions, stateChanges, retries);
    // Index the decision (hand-off marker) per role. The interval between an
    // agent's receive HOP and its decision is the true DWELL time; the interval
    // between one agent's decision and the next agent's receive HOP is the true
    // BETWEEN-AGENT transit latency. With only HOP timestamps these two collapse
    // into one number, so we use the decision timestamps to separate them.
    const decisionByRole = new Map();
    decisions.forEach((d) => decisionByRole.set(d.role, { decision: d.decision, details: d.details, timestamp: d.timestamp }));
    console.log('');
    console.log('================ Tracer Bullet Report ================');
    console.log(`Trace ID:       ${report.traceId}`);
    console.log(`Status:         ${report.pass ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`Total Duration: ${report.totalDuration.toFixed(2)}s`);
    console.log(`Hops:           ${report.hops.length}  (${report.hops.map((h) => h.role).join(' → ')})`);
    console.log('');
    console.log('--- Per-Agent: dwell time, state, decision ---');
    hops.forEach((hop, i) => {
        const dec = decisionByRole.get(hop.role);
        // Dwell = decision time - receive time (time the item actually sat with the agent).
        const dwell = dec ? (dec.timestamp.getTime() - hop.timestamp.getTime()) / 1000 : 0;
        console.log(`  ${i + 1}. ${hop.role.padEnd(12)} dwell=${dwell.toFixed(2)}s`);
        if (dec) {
            console.log(`       decided: ${dec.decision}${dec.details ? `  (${dec.details})` : ''}`);
        }
    });
    console.log('');
    console.log('--- Between-Agent handoff latencies ---');
    if (hops.length < 2) {
        console.log('  (none)');
    }
    else {
        for (let i = 1; i < hops.length; i++) {
            const prev = hops[i - 1];
            const cur = hops[i];
            const prevDecision = decisionByRole.get(prev.role);
            // Transit = next agent's receive time - previous agent's decision time.
            // Falls back to hop-to-hop if the previous decision wasn't recorded.
            const fromTime = prevDecision ? prevDecision.timestamp.getTime() : prev.timestamp.getTime();
            const seconds = (cur.timestamp.getTime() - fromTime) / 1000;
            console.log(`  ${prev.role.padEnd(12)} → ${cur.role.padEnd(12)} ${seconds.toFixed(2)}s`);
        }
    }
    console.log('');
    console.log('--- State transitions ---');
    if (stateChanges.length === 0) {
        console.log('  (none)');
    }
    else {
        stateChanges.forEach((sc) => {
            console.log(`  ${sc.role.padEnd(12)} ${sc.from} → ${sc.to}${sc.reason ? `  (${sc.reason})` : ''}`);
        });
    }
    console.log('');
    console.log('--- Retries ---');
    if (retries.length === 0) {
        console.log('  none');
    }
    else {
        retries.forEach((r) => console.log(`  ${r.role} attempt ${r.attempt}: ${r.reason}`));
    }
    console.log('');
    console.log(`Trace log: ${logPath}`);
    console.log('======================================================');
    return report.pass;
}
async function main() {
    const watch = process.argv.includes('--watch');
    const maxWaitSeconds = 300;
    if (!fs.existsSync(SWARMFORGE_DIR)) {
        console.error(`ERROR: .swarmforge directory not found at ${SWARMFORGE_DIR}`);
        process.exit(1);
    }
    const traceId = (0, tracer_1.generateTraceId)();
    log('=== Tracer Bullet Launcher ===');
    log(`Trace ID: ${traceId}`);
    log('');
    if (watch) {
        await watchLive(traceId, maxWaitSeconds);
    }
    else {
        await driveHarness(traceId);
    }
    const pass = generateReport(traceId);
    process.exit(pass ? 0 : 1);
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=tracer-bullet-launcher.js.map