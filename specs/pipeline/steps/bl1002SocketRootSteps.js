'use strict';

// BL-1002: step handlers for "Every socket-building acceptance fixture
// roots short enough for the socket guard". Scenario 01 drives the REAL
// BL-948 gate module (lib/socketFixtureRootGuard.js) over the REAL
// step-handler tree - the gate, not a roster of file names, decides which
// files are in scope (the ticket's declared invariant). Scenario 02 builds
// REAL fixture roots through the shared helper using each changed file's
// own prefixes, validated against explicit KNOWN_FILES and against the
// file's own source - never passthrough. Scenario 03 re-runs each changed
// file's own feature end to end via run_acceptance.sh in its own outDir
// (the bl520RewrapLegacyWrappedSteps nested-run precedent, so generation
// stays sequential per run).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SOCKET_PATH_GUARD_LIMIT,
  WORST_CASE_SOCKET_SUFFIX,
  mkSocketFixtureRoot,
  releaseSocketFixtureRoot,
} = require('./lib/socketFixtureRoot');
const {
  findSocketFixtureRootViolation,
  scanForSocketFixtureRootViolations,
} = require('./lib/socketFixtureRootGuard');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_DIR = __dirname;
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');

// BL-982 scenario 06 is PARKED (BL-1002 amendment e7244b52a, 2026-08-21): it
// asserts a slice boundary BL-983 deliberately removed, so it is red because
// the system works. BL-1006 owns retiring it. The park is derived from the
// backlog at run time, never pinned: the tolerance below holds only while
// BL-1006's ticket still sits in an open lifecycle location (Article 3.1's
// root intake, paused/, active/, or hold/), so the moment BL-1006 closes
// into done/ this step demands a fully green nested run again instead of
// rotting into a stale allowance.
const PARKED_SCENARIO_RE = /^\s*not ok \d+ - the second seat is inert until the mailbox slice lands/m;
const PARKED_FAILURE_REASON = 'the second seat must claim nothing (NO_TASK)';
const OPEN_BACKLOG_DIRS = ['', 'paused', 'active', 'hold'];

function scenario06ParkStillOwned() {
  return OPEN_BACKLOG_DIRS.some((dir) => {
    const at = path.join(REPO_ROOT, 'backlog', dir);
    if (!fs.existsSync(at)) return false;
    return fs
      .readdirSync(at, { withFileTypes: true })
      .some((entry) => entry.isFile() && /^BL-1006-.*\.yaml$/.test(entry.name));
  });
}

const FEATURE = 'Every socket-building acceptance fixture roots short enough for the socket guard';

// Explicit known values per the Scenario Outline handler rule: each named
// file maps to the fixture-root prefixes its own source must hand to
// mkSocketFixtureRoot, and to its own feature file for the
// behaviour-unchanged re-run. An unknown <file> is a hard failure.
const KNOWN_FILES = {
  'bl982SecondSeatSteps.js': {
    prefixes: ['bl982-acc-', 'bl982-pre-sh-'],
    feature: 'BL-982-second-seat-of-a-stage-boots-with-its-own-model.feature',
  },
  'bl983StageQueueSteps.js': {
    prefixes: ['bl983-acc-'],
    feature: 'BL-983-stage-mailbox-delivers-to-one-idle-seat.feature',
  },
};

function knownFile(file) {
  const entry = KNOWN_FILES[file];
  if (!entry) {
    throw new Error(
      `bl1002: unknown file "${file}" - add it to KNOWN_FILES deliberately, never passthrough`
    );
  }
  return entry;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^the socket-fixture root gate and the shared short-root helper$/, () => {
    assert.equal(typeof scanForSocketFixtureRootViolations, 'function');
    assert.equal(typeof mkSocketFixtureRoot, 'function');
  });

  // ── steps-tree-has-no-long-socket-roots-01 ─────────────────────────────
  scoped(/^the gate scans the step-handler tree$/, (ctx) => {
    ctx.violations = scanForSocketFixtureRootViolations(STEPS_DIR);
  });

  scoped(/^it reports no violations$/, (ctx) => {
    assert.deepEqual(
      ctx.violations,
      [],
      `expected zero socket-fixture-root violations under ${STEPS_DIR}, found:\n` +
        JSON.stringify(ctx.violations, null, 2)
    );
  });

  // ── socket-path-fits-the-guard-02 ──────────────────────────────────────
  scoped(/^a fixture root built by (\S+) for a control socket$/, (ctx, file) => {
    const { prefixes } = knownFile(file);
    const source = fs.readFileSync(path.join(STEPS_DIR, file), 'utf8');
    for (const prefix of prefixes) {
      assert.ok(
        source.includes(`mkSocketFixtureRoot('${prefix}')`),
        `bl1002: ${file} must build its "${prefix}" root through mkSocketFixtureRoot - ` +
          'the known prefix has drifted from the file, update KNOWN_FILES with the change that moved it'
      );
    }
    ctx.roots = prefixes.map((prefix) => mkSocketFixtureRoot(prefix));
  });

  scoped(/^a control socket path is formed under it$/, (ctx) => {
    ctx.socketPaths = ctx.roots.map((root) => `${root}${WORST_CASE_SOCKET_SUFFIX}`);
  });

  scoped(/^the path is within the socket guard's limit$/, (ctx) => {
    try {
      assert.ok(ctx.socketPaths.length > 0, 'bl1002: no socket paths were formed');
      for (const socketPath of ctx.socketPaths) {
        assert.ok(
          socketPath.length <= SOCKET_PATH_GUARD_LIMIT,
          `${socketPath} is ${socketPath.length} chars - over the ${SOCKET_PATH_GUARD_LIMIT}-char guard`
        );
      }
    } finally {
      for (const root of ctx.roots || []) {
        fs.rmSync(root, { recursive: true, force: true });
        releaseSocketFixtureRoot(root);
      }
      ctx.roots = [];
    }
  });

  // ── the-behaviour-those-scenarios-assert-is-unchanged-03 ───────────────
  scoped(/^the step file (\S+) after its fixture root is shortened$/, (ctx, file) => {
    const entry = knownFile(file);
    const filePath = path.join(STEPS_DIR, file);
    // The REAL gate's own per-file predicate (comment-stripping included),
    // never a second weaker source check that could disagree with it.
    const violation = findSocketFixtureRootViolation(filePath, fs.readFileSync(filePath, 'utf8'));
    assert.equal(
      violation,
      null,
      `bl1002: ${file} still roots a fixture at a long base: ${JSON.stringify(violation)}`
    );
    ctx.siblingFeature = path.join(REPO_ROOT, 'specs', 'features', entry.feature);
    assert.ok(fs.existsSync(ctx.siblingFeature), `bl1002: ${entry.feature} not found`);
  });

  scoped(/^its scenarios run$/, (ctx) => {
    const outRoot = mkSocketFixtureRoot('bl1002-out-');
    try {
      ctx.nested = spawnSync(
        'bash',
        [RUN_ACCEPTANCE, ctx.siblingFeature, path.join(outRoot, 'generated')],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      );
    } finally {
      fs.rmSync(outRoot, { recursive: true, force: true });
      releaseSocketFixtureRoot(outRoot);
    }
  });

  scoped(/^they pass for the reason they were written, not on a socket refusal$/, (ctx) => {
    const out = `${ctx.nested.stdout}\n${ctx.nested.stderr}`;
    // swarm_socket_lib.bb's refusal names the unix-socket path limit; a pass
    // that only worked around a refusal would surface it here. A refusal is
    // this parcel's defect in every case, parked red included.
    assert.ok(
      !/unix-socket path limit/.test(out),
      `nested run hit the socket guard's refusal:\n${out}`
    );
    const passCount = out.match(/^# pass (\d+)$/m);
    assert.ok(passCount && Number(passCount[1]) > 0, `no scenario passed in the nested run:\n${out}`);
    const failMatch = out.match(/^# fail (\d+)$/m);
    assert.ok(failMatch, `nested run reported no fail count:\n${out}`);
    const failCount = Number(failMatch[1]);
    if (ctx.nested.status === 0 && failCount === 0) return;
    // Not fully green: the ONLY tolerated shape is BL-982 scenario 06's
    // parked red, failing for its recorded reason, while BL-1006 still owns
    // it (see scenario06ParkStillOwned above). What this parcel owes that
    // scenario is narrow: it must not change WHY it fails.
    assert.equal(
      failCount,
      1,
      `nested run reported ${failCount} failures; only BL-982 scenario 06's parked red (BL-1006) is tolerated:\n${out}`
    );
    assert.ok(
      PARKED_SCENARIO_RE.test(out),
      `the one nested failure is not the parked BL-982 scenario 06:\n${out}`
    );
    assert.ok(
      out.includes(PARKED_FAILURE_REASON),
      `scenario 06 no longer fails on "${PARKED_FAILURE_REASON}" - a changed failure reason IS this parcel's defect:\n${out}`
    );
    assert.ok(
      scenario06ParkStillOwned(),
      `BL-1006 is no longer open in the backlog, so its parked red is not tolerated any more:\n${out}`
    );
  });
}

module.exports = { registerSteps };
