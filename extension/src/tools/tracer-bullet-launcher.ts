#!/usr/bin/env node
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  generateTraceId,
  createTraceLog,
  appendTraceHop,
  recordAgentDecision,
  recordStateChange,
  recordRetry,
  parseFullTraceLog,
  computeTraceReport,
} from '../swarm/tracer';

const SWARMFORGE_DIR = path.join(process.cwd(), '.swarmforge');
const TRACES_DIR = path.join(SWARMFORGE_DIR, 'traces');

/**
 * Canonical forward chain for a tracer bullet — the full pipeline
 * (BL-136: the harness previously stopped at cleaner, four hops short of
 * the real chain, which made the harness pass regardless of whether the
 * remaining four roles' trace-hop wiring worked at all).
 */
const CHAIN = [
  'coordinator',
  'specifier',
  'coder',
  'cleaner',
  'architect',
  'hardender',
  'documenter',
  'QA',
] as const;
type Role = (typeof CHAIN)[number];

/**
 * What each role does to a tracer bullet (no real implementation occurs).
 * `state` mirrors trace-hop.ts's PHASE_MAP and `decision` mirrors the exact
 * decision string each role's "Tracer Bullet Participation" prompt block
 * uses, so the harness models the same forward chain the live prompts do.
 */
const ROLE_PLAYBOOK: Record<Role, { state: string; decision: string; details: string }> = {
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
    decision: 'forward_to_architect',
    details: 'no cleanup needed for tracer bullet; forwarding',
  },
  architect: {
    state: 'architecting',
    decision: 'forward_to_hardender',
    details: 'no review needed for tracer bullet; forwarding',
  },
  hardender: {
    state: 'hardening',
    decision: 'forward_to_documenter',
    details: 'no hardening needed for tracer bullet; forwarding',
  },
  documenter: {
    state: 'documenting',
    decision: 'forward_to_QA',
    details: 'no docs needed for tracer bullet; forwarding',
  },
  QA: {
    state: 'qa-verifying',
    decision: 'verify_and_complete',
    details: 'verified pipeline reached QA; item complete',
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function driveHarness(traceId: string): Promise<void> {
  log('Mode: harness (driving all roles through the real tracer module)');
  log('');

  // Seed the log with the coordinator HOP.
  createTraceLog(
    TRACES_DIR,
    traceId,
    `TRACE ${traceId} HOP coordinator ${new Date().toISOString()} action=receive state=queued`
  );

  for (let i = 0; i < CHAIN.length; i++) {
    const role = CHAIN[i];
    const play = ROLE_PLAYBOOK[role];

    // The coordinator HOP is already seeded; append for the rest.
    if (i > 0) {
      // Handoff latency: realistic small transit delay between agents.
      await sleep(150 + Math.floor(Math.random() * 250));
      appendTraceHop(TRACES_DIR, traceId, role, 'receive', 'received');
    }

    // Agent records its state change and decision.
    recordStateChange(TRACES_DIR, traceId, role, 'received', play.state, 'began processing');

    // Dwell: realistic processing time at this agent.
    await sleep(200 + Math.floor(Math.random() * 400));

    recordAgentDecision(TRACES_DIR, traceId, role, play.decision, play.details);
    log(`✓ ${role.padEnd(12)} → ${play.decision}`);
  }

  log('');
  log('✓ Pipeline complete — tracer bullet reached QA');
}

/** The terminal role of the real pipeline (see CHAIN above). */
const TERMINAL_ROLE: Role = 'QA';

/**
 * The seed draft handed to swarm_handoff.sh to kick off a live tracer bullet.
 * Pure and exported for unit testing — the actual send (sendSeedNote) is the
 * I/O boundary around it.
 */
export function buildSeedDraft(traceId: string): string {
  return `type: note\nto: coordinator\npriority: 00\nmessage: TRACE ${traceId}\n`;
}

/**
 * Sends the seed note through the REAL handoff transport (swarm_handoff.sh)
 * — never write directly into inbox/new (constitution: "Send only via
 * swarm_handoff.sh"). BL-136: this used to only mkdir the inbox directory
 * and never actually enqueue anything, so `--watch` silently never started
 * the live pipeline; a human had to inject the note by hand.
 */
function sendSeedNote(traceId: string, repoRoot: string): void {
  const draftPath = path.join(os.tmpdir(), `tracer-bullet-seed-${traceId}.txt`);
  fs.writeFileSync(draftPath, buildSeedDraft(traceId), 'utf-8');
  const handoffScript = path.join(repoRoot, 'swarmforge', 'scripts', 'swarm_handoff.sh');
  execFileSync(handoffScript, [draftPath], {
    cwd: repoRoot,
    env: { ...process.env, SWARMFORGE_ROLE: process.env.SWARMFORGE_ROLE || 'coordinator' },
    stdio: 'pipe',
  });
}

async function watchLive(traceId: string, maxWaitSeconds: number): Promise<void> {
  log('Mode: watch (polling live agents appending their own hops)');
  log('');

  createTraceLog(
    TRACES_DIR,
    traceId,
    `TRACE ${traceId} HOP coordinator ${new Date().toISOString()} action=seed state=queued`
  );

  // Trace-aware role prompts instruct each agent to append a HOP and forward
  // the same TRACE note down the chain once the coordinator receives this.
  sendSeedNote(traceId, process.cwd());
  log(`Seeded trace ${traceId}. Waiting for live agents to append hops...`);

  const startTime = Date.now();
  let lastCount = 1;
  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    const logPath = path.join(TRACES_DIR, `${traceId}.log`);
    if (fs.existsSync(logPath)) {
      const { hops } = parseFullTraceLog(fs.readFileSync(logPath, 'utf-8'));
      if (hops.length > lastCount) {
        const newest = hops[hops.length - 1];
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`✓ ${newest.role} hop (${elapsed}s elapsed)`);
        lastCount = hops.length;
        if (newest.role === TERMINAL_ROLE) {
          log(`✓ Pipeline complete — reached ${TERMINAL_ROLE}`);
          return;
        }
      }
    }
    await sleep(3000);
  }
  console.error(`TIMEOUT: tracer bullet did not reach ${TERMINAL_ROLE} within ${maxWaitSeconds}s`);
}

function generateReport(traceId: string): boolean {
  const logPath = path.join(TRACES_DIR, `${traceId}.log`);
  if (!fs.existsSync(logPath)) {
    console.error('Trace log not found');
    return false;
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const { hops, decisions, stateChanges, retries } = parseFullTraceLog(content);
  const report = computeTraceReport(hops, traceId, decisions, stateChanges, retries);

  // Index the decision (hand-off marker) per role. The interval between an
  // agent's receive HOP and its decision is the true DWELL time; the interval
  // between one agent's decision and the next agent's receive HOP is the true
  // BETWEEN-AGENT transit latency. With only HOP timestamps these two collapse
  // into one number, so we use the decision timestamps to separate them.
  const decisionByRole = new Map<string, { decision: string; details?: string; timestamp: Date }>();
  decisions.forEach((d) =>
    decisionByRole.set(d.role, { decision: d.decision, details: d.details, timestamp: d.timestamp })
  );

  console.log('');
  console.log('================ Tracer Bullet Report ================');
  console.log(`Trace ID:       ${report.traceId}`);
  console.log(`Status:         ${report.pass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`Total Duration: ${report.totalDuration.toFixed(2)}s`);
  console.log(`Hops:           ${report.hops.length}  (${report.hops.map((h: any) => h.role).join(' → ')})`);
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
  } else {
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
  } else {
    stateChanges.forEach((sc) => {
      console.log(`  ${sc.role.padEnd(12)} ${sc.from} → ${sc.to}${sc.reason ? `  (${sc.reason})` : ''}`);
    });
  }

  console.log('');
  console.log('--- Retries ---');
  if (retries.length === 0) {
    console.log('  none');
  } else {
    retries.forEach((r) => console.log(`  ${r.role} attempt ${r.attempt}: ${r.reason}`));
  }

  console.log('');
  console.log(`Trace log: ${logPath}`);
  console.log('======================================================');
  return report.pass;
}

async function main(): Promise<void> {
  const watch = process.argv.includes('--watch');
  const maxWaitSeconds = 300;

  if (!fs.existsSync(SWARMFORGE_DIR)) {
    console.error(`ERROR: .swarmforge directory not found at ${SWARMFORGE_DIR}`);
    process.exit(1);
  }

  const traceId = generateTraceId();
  log('=== Tracer Bullet Launcher ===');
  log(`Trace ID: ${traceId}`);
  log('');

  if (watch) {
    await watchLive(traceId, maxWaitSeconds);
  } else {
    await driveHarness(traceId);
  }

  const pass = generateReport(traceId);
  process.exit(pass ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
