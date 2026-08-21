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
    assert.equal(ctx.nested.status, 0, `nested acceptance run failed:\n${out}`);
    const passCount = out.match(/^# pass (\d+)$/m);
    assert.ok(passCount && Number(passCount[1]) > 0, `no scenario passed in the nested run:\n${out}`);
    const failCount = out.match(/^# fail (\d+)$/m);
    assert.ok(failCount && Number(failCount[1]) === 0, `nested run reported failures:\n${out}`);
    // swarm_socket_lib.bb's refusal names the unix-socket path limit; a pass
    // that only worked around a refusal would surface it here.
    assert.ok(
      !/unix-socket path limit/.test(out),
      `nested run hit the socket guard's refusal:\n${out}`
    );
  });
}

module.exports = { registerSteps };
