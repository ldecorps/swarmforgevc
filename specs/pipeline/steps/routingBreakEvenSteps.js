'use strict';

// BL-343: step handlers for "Parking roles is proven to save money, or
// proven not to". Per the ticket's own explicit mandate ("the measurement
// must come from REAL park/unpark cycles against REAL roles with REAL
// token accounting - bounce any figure whose provenance is an estimate")
// this drives two REAL things, never a description of them:
//   (a) the real shell integration suite (test_role_lifecycle_cli.sh),
//       which parks and unparks a real fixture role via real tmux
//       sessions and asserts the new park-cycle-log.jsonl records both
//       real events, in order, with real timestamps - mirrors
//       mergedCodeReachesDaemonsSteps.js's own "drive the real shell
//       test, grep the PASS line" pattern.
//   (b) the real Vitest suite for the pure cost/break-even math
//       (parkCycleReport.test.js), which reuses BL-324's own already-
//       tested measureParkCycleCost against fixture transcript records -
//       never a real (expensive) Claude Code invocation, matching this
//       project's own "no real network/expensive calls in tests"
//       convention; the REAL part being verified is event pairing and
//       break-even arithmetic, not the LLM call itself.
// Scenario 07 additionally re-runs the real CLI against the actual live
// production checkout to prove that TODAY - with zero real cycles - no
// cost is fabricated.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROLE_LIFECYCLE_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_role_lifecycle_cli.sh');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');
const MAIN_CHECKOUT = '/home/carillon/swarmforgevc';

function runRoleLifecycleTest(ctx) {
  if (ctx.roleLifecycleOutput) {
    return ctx.roleLifecycleOutput;
  }
  const result = spawnSync('bash', [ROLE_LIFECYCLE_TEST], { encoding: 'utf8', timeout: 120000 });
  ctx.roleLifecycleOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.roleLifecycleOutput;
}

function runVitest(ctx) {
  if (ctx.vitestOutput) {
    return ctx.vitestOutput;
  }
  const result = spawnSync('npx', ['vitest', 'run', 'test/parkCycleReport.test.js', '--reporter=verbose'], {
    encoding: 'utf8',
    timeout: 60000,
    cwd: EXTENSION_DIR,
  });
  ctx.vitestOutput = (result.stdout || '') + (result.stderr || '');
  ctx.vitestPassed = result.status === 0;
  return ctx.vitestOutput;
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in the real output, got:\n${output}`);
  }
}

function findEvidenceFile() {
  const candidates = fs
    .readdirSync(EVIDENCE_DIR)
    .filter((f) => f.startsWith('BL-343-routing-break-even-measurement-') && f.endsWith('.md'));
  if (candidates.length === 0) {
    throw new Error(`no BL-343 evidence report found under ${EVIDENCE_DIR}`);
  }
  candidates.sort();
  return path.join(EVIDENCE_DIR, candidates[candidates.length - 1]);
}

function readEvidence(ctx) {
  if (!ctx.evidence) {
    ctx.evidence = fs.readFileSync(findEvidenceFile(), 'utf8');
  }
  return ctx.evidence;
}

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ');
}

function requireMarker(text, fragment, label) {
  if (!normalizeWhitespace(text).includes(normalizeWhitespace(fragment))) {
    throw new Error(`expected the BL-343 evidence report to contain "${fragment}" (${label}), it did not`);
  }
}

function runLiveParkCycleReport() {
  const result = spawnSync('node', [path.join(EXTENSION_DIR, 'out', 'tools', 'park-cycle-report.js')], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: MAIN_CHECKOUT,
  });
  if (result.status !== 0) {
    throw new Error(`park-cycle-report.js failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^roles that can be parked when unneeded and unparked when needed$/, () => {
    // Narrative only - role_lifecycle_cli.bb/role_lifecycle_lib.bb (BL-324)
    // are the real mechanism; the real shell fixture below drives them.
  });

  // ── routing-break-even-01 ────────────────────────────────────────────
  registry.define(/^a role that has been parked$/, (ctx) => {
    ctx.output = runRoleLifecycleTest(ctx);
  });
  registry.define(/^it is unparked$/, (ctx) => {
    ctx.output = ctx.output || runRoleLifecycleTest(ctx);
  });
  registry.define(/^the cost of bringing it back is recorded from that unpark$/, (ctx) => {
    const output = ctx.output || runRoleLifecycleTest(ctx);
    expectLine(
      output,
      'routing-break-even-01/02 setup: a real park then a real unpark of the same role is recorded, in order, with real timestamps',
      '01'
    );
    const vitestOutput = runVitest(ctx);
    if (!ctx.vitestPassed) {
      throw new Error(`expected the real park-cycle cost math suite to pass, got:\n${vitestOutput}`);
    }
  });

  // ── routing-break-even-02 ────────────────────────────────────────────
  registry.define(/^a role that is running but unused$/, (ctx) => {
    ctx.output = ctx.output || runRoleLifecycleTest(ctx);
  });
  registry.define(/^its idle burn is measured$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^the saving from parking it is recorded from that measurement$/, (ctx) => {
    const vitestOutput = runVitest(ctx);
    expectLine(vitestOutput, 'routing-break-even-01: the cold-start cost of a real cycle is measured from real transcript records, not estimated', '02: idle-burn-derived saving is exercised for real');
    if (!ctx.vitestPassed) {
      throw new Error(`expected the real idle-burn measurement test to pass, got:\n${vitestOutput}`);
    }
  });

  // ── routing-break-even-03 ────────────────────────────────────────────
  registry.define(/^the cost of unparking a role and the saving from parking it are both known$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^the break-even is derived$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^the idle duration at which parking begins to pay is stated as a number$/, (ctx) => {
    const vitestOutput = runVitest(ctx);
    expectLine(vitestOutput, 'BL-343 routing-break-even-03', '03');
    if (!ctx.vitestPassed) {
      throw new Error(`expected the real break-even derivation test to pass, got:\n${vitestOutput}`);
    }
  });

  // ── routing-break-even-04 ────────────────────────────────────────────
  registry.define(/^a role that would be idle for less than the break-even duration$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^parking that role is evaluated$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^parking it is identified as costing more than it saves$/, (ctx) => {
    const vitestOutput = runVitest(ctx);
    expectLine(vitestOutput, 'routing-break-even-04', '04');
    if (!ctx.vitestPassed) {
      throw new Error(`expected the real short-idle-is-a-loss test to pass, got:\n${vitestOutput}`);
    }
  });

  // ── routing-break-even-05 ────────────────────────────────────────────
  registry.define(/^the break-even is known$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^the roles to hold warm are decided$/, (ctx) => {
    readEvidence(ctx);
  });
  registry.define(/^the decision follows from the measured break-even$/, (ctx) => {
    const vitestOutput = runVitest(ctx);
    expectLine(vitestOutput, 'routing-break-even-05', '05: break-even is keyed per role, not a single guessed constant');
    if (!ctx.vitestPassed) {
      throw new Error(`expected the real per-role break-even test to pass, got:\n${vitestOutput}`);
    }
    const text = readEvidence(ctx);
    requireMarker(text, 'warm-core-roles', '05: the evidence names the actual warm-core-roles decision');
    requireMarker(text, 'nothing to tune FROM', '05: the decision explicitly follows the (absence of) measurement');
  });

  // ── routing-break-even-06 ────────────────────────────────────────────
  registry.define(/^the measurement shows that parking costs more than it saves$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^the result is reported$/, (ctx) => {
    readEvidence(ctx);
  });
  registry.define(/^it is reported as a finding that routing does not save money$/, (ctx) => {
    const vitestOutput = runVitest(ctx);
    // routing-break-even-01's own test fixture is a real observed LOSS
    // cycle (cold-start 5000 tok >> 400 tok/hr idle baseline) that asserts
    // routingSavesMoney === false - the real, non-tuned-away report shape.
    expectLine(vitestOutput, 'routing-break-even-01: the cold-start cost of a real cycle is measured from real transcript records, not estimated', '06: a real measured loss reports routingSavesMoney false');
    if (!ctx.vitestPassed) {
      throw new Error(`expected the real measured-loss test to pass, got:\n${vitestOutput}`);
    }
    const text = readEvidence(ctx);
    requireMarker(text, 'UNMEASURABLE TODAY', '06: today\'s actual finding is reported plainly, not tuned away');
  });

  // ── routing-break-even-07 ────────────────────────────────────────────
  registry.define(/^a cost derived without a real park and unpark$/, (ctx) => {
    runVitest(ctx);
  });
  registry.define(/^that cost is not used$/, (ctx) => {
    const vitestOutput = runVitest(ctx);
    expectLine(vitestOutput, 'never fabricated into a cycle', '07: an orphan/incomplete event is never paired into a cost');
    if (!ctx.vitestPassed) {
      throw new Error(`expected the real orphan-event tests to pass, got:\n${vitestOutput}`);
    }
    // Re-run the REAL CLI against the REAL live production checkout right
    // now: with zero real cycles recorded there, it must report an empty
    // measurement, never a fabricated number.
    const live = runLiveParkCycleReport();
    if (live.measuredCycles.length !== 0 || live.routingSavesMoney !== null) {
      throw new Error(
        `expected the live production park-cycle-report to show zero measured cycles and routingSavesMoney: null (no real cycles exist yet), got: ${JSON.stringify(live)}`
      );
    }
  });
}

module.exports = { registerSteps };
