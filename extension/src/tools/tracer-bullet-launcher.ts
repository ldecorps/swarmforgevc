#!/usr/bin/env node
/**
 * Tracer Bullet Launcher
 *
 * Launches a test work item through the SwarmForge pipeline and monitors:
 * - All state transitions at each agent
 * - Time spent at each agent
 * - Time between agents (handoff latency)
 * - Agent decisions and routing choices
 * - Any retries or error recovery
 *
 * Output: Full lifecycle report to stdout and trace log to .swarmforge/traces/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { generateTraceId, createTraceLog, appendTraceHop, recordAgentDecision, recordStateChange, recordRetry, parseFullTraceLog, computeTraceReport, TraceHop } from '../swarm/tracer';

const SWARMFORGE_DIR = path.join(process.cwd(), '.swarmforge');
const TRACES_DIR = path.join(SWARMFORGE_DIR, 'traces');

interface TracerConfig {
  testName: string;
  description: string;
  maxWaitSeconds: number;
}

const DEFAULT_CONFIG: TracerConfig = {
  testName: 'tracer-bullet-test',
  description: 'End-to-end pipeline test',
  maxWaitSeconds: 300,
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function createTestSpecification(traceId: string): string {
  return `# Tracer Bullet Test: ${traceId}

A minimal test work item to validate the full 4-pack pipeline:
coordinator → specifier → coder → cleaner

Expected behavior:
1. Specifier receives note with test item ID
2. Coordinator routes to coder
3. Coder marks complete (no implementation needed)
4. Coder routes to cleaner
5. Cleaner verifies and routes to specifier
6. Pipeline complete

Trace ID: ${traceId}
`;
}

function createTestHandoff(traceId: string): string {
  return `type: note
to: coordinator
priority: 00
message: Tracer bullet test: ${traceId} - minimal test item for pipeline validation
`;
}

async function launchTracerBullet(config: Partial<TracerConfig> = {}): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const traceId = generateTraceId();

  log(`=== Tracer Bullet Launcher ===`);
  log(`Test: ${cfg.testName}`);
  log(`Description: ${cfg.description}`);
  log(`Trace ID: ${traceId}`);
  log(`Max wait: ${cfg.maxWaitSeconds}s`);
  log('');

  // Verify swarmforge directory exists
  if (!fs.existsSync(SWARMFORGE_DIR)) {
    console.error(`ERROR: .swarmforge directory not found at ${SWARMFORGE_DIR}`);
    process.exit(1);
  }

  // Create trace log
  const initialBody = `TRACE ${traceId} HOP coordinator ${new Date().toISOString()}`;
  try {
    createTraceLog(TRACES_DIR, traceId, initialBody);
    log(`✓ Created trace log: ${TRACES_DIR}/${traceId}.log`);
  } catch (err: any) {
    console.error(`Failed to create trace log: ${err.message}`);
    process.exit(1);
  }

  // Create test specification and handoff
  const specFile = path.join(process.cwd(), 'tmp', `tracer-bullet-${traceId}.spec.md`);
  const handoffFile = path.join(process.cwd(), 'tmp', `tracer-bullet-${traceId}.handoff`);

  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(specFile, createTestSpecification(traceId));
  log(`✓ Created test spec: ${specFile}`);

  // Write handoff to coordinator inbox
  const handoffContent = createTestHandoff(traceId);
  const inboxDir = path.join(SWARMFORGE_DIR, 'handoffs', 'inbox', 'new');
  fs.mkdirSync(inboxDir, { recursive: true });

  const timestamp = new Date();
  const handoffFilename = `00_${timestamp.getUTCFullYear()}${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}${String(timestamp.getUTCDate()).padStart(2, '0')}T${String(timestamp.getUTCHours()).padStart(2, '0')}${String(timestamp.getUTCMinutes()).padStart(2, '0')}${String(timestamp.getUTCSeconds()).padStart(2, '0')}Z_000_from_specifier_to_coordinator.handoff`;
  const handoffPath = path.join(inboxDir, handoffFilename);

  fs.writeFileSync(handoffPath, handoffContent);
  log(`✓ Created handoff: ${handoffPath}`);
  log('');

  // Record initial state
  recordStateChange(TRACES_DIR, traceId, 'coordinator', 'idle', 'queued', 'test handoff received');

  // Wait for pipeline to process
  log('Monitoring pipeline...');
  const startTime = Date.now();
  const maxWaitMs = cfg.maxWaitSeconds * 1000;

  // Poll for trace log updates
  const pollInterval = 5000; // 5 seconds
  let lastHopCount = 1;

  while (Date.now() - startTime < maxWaitMs) {
    const logPath = path.join(TRACES_DIR, `${traceId}.log`);
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      const { hops } = parseFullTraceLog(content);

      if (hops.length > lastHopCount) {
        const newHop = hops[hops.length - 1];
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        log(`✓ ${newHop.role} received (${elapsedSeconds.toFixed(1)}s elapsed)`);
        lastHopCount = hops.length;

        // Check if pipeline completed
        if (newHop.role === 'cleaner') {
          log('');
          log('✓ Pipeline complete - tracer bullet reached cleaner');
          await generateReport(traceId);
          return;
        }
      }
    }

    await sleep(pollInterval);
  }

  // Timeout
  console.error('');
  console.error(`TIMEOUT: Tracer bullet did not complete within ${cfg.maxWaitSeconds}s`);
  await generateReport(traceId);
  process.exit(1);
}

async function generateReport(traceId: string): Promise<void> {
  const logPath = path.join(TRACES_DIR, `${traceId}.log`);

  if (!fs.existsSync(logPath)) {
    console.error('Trace log not found');
    return;
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const { hops, decisions, stateChanges, retries } = parseFullTraceLog(content);

  const report = computeTraceReport(hops, traceId, decisions, stateChanges, retries);

  console.log('');
  console.log('=== Tracer Bullet Report ===');
  console.log(`Trace ID: ${report.traceId}`);
  console.log(`Status: ${report.pass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`Total Duration: ${report.totalDuration.toFixed(2)}s`);
  console.log('');

  console.log('--- Pipeline Path ---');
  report.hops.forEach((hop: any, i: number) => {
    const timeInHop = hop.duration || 0;
    const label = `${i + 1}. ${hop.role.padEnd(12)} (${timeInHop.toFixed(2)}s)`;
    if (hop.action) {
      console.log(`  ${label} | action: ${hop.action}`);
    } else {
      console.log(`  ${label}`);
    }
    if (hop.state) {
      console.log(`    └─ state: ${hop.state}`);
    }
  });

  if (report.transitions.length > 0) {
    console.log('');
    console.log('--- Handoff Latencies ---');
    report.transitions.forEach((t: any) => {
      console.log(`  ${t.from} → ${t.to}: ${t.seconds.toFixed(2)}s`);
    });
  }

  if (decisions.length > 0) {
    console.log('');
    console.log('--- Agent Decisions ---');
    decisions.forEach((d: any) => {
      const label = `${d.role}: ${d.decision}`;
      if (d.details) {
        console.log(`  ${label} (${d.details})`);
      } else {
        console.log(`  ${label}`);
      }
    });
  }

  if (stateChanges.length > 0) {
    console.log('');
    console.log('--- State Transitions ---');
    stateChanges.forEach((sc: any) => {
      const label = `${sc.role}: ${sc.from} → ${sc.to}`;
      if (sc.reason) {
        console.log(`  ${label} (${sc.reason})`);
      } else {
        console.log(`  ${label}`);
      }
    });
  }

  if (retries.length > 0) {
    console.log('');
    console.log('--- Retries ---');
    retries.forEach((r: any) => {
      console.log(`  ${r.role} attempt ${r.attempt}: ${r.reason}`);
    });
  }

  console.log('');
  console.log(`Trace log: ${logPath}`);
}

// Main entry point
launchTracerBullet().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
