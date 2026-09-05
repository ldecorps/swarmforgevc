'use strict';

// BL-1289: step handlers for "every bb and shell test runner cleans up the
// temp root it creates". Scenarios 01/02 drive the REAL regression guard
// (specs/pipeline/steps/lib/tempDirTrapGuard.js), never a reimplementation -
// scenario 02 in particular scans the ACTUAL swarmforge/scripts tree, which
// is the ticket's own acceptance bar (a runner fixed by this ticket that
// regresses tomorrow fails this scenario, not just the unit-lane guard).
// Scenario 03 drives the REAL lib/fixture_isolation.sh's own
// fixture_isolation_reap - the "sweep by owner-liveness before the next run
// asserts" half of the invariant, which no trap or shutdown hook can ever
// cover (nothing traps SIGKILL).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findTempDirTrapViolation, scanForTempDirTrapViolations } = require('./lib/tempDirTrapGuard');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const FIXTURE_ISOLATION_SH = path.join(SCRIPTS_DIR, 'test', 'lib', 'fixture_isolation.sh');

const FEATURE = 'Every bb and shell test runner cleans up the temp root it creates';

// Scenario Outline <mechanism>/<verdict> validated against explicit lookups
// (the Outline rule: no passthrough/binary checks). Bodies assembled by
// concatenation so THIS file's own text never contains the contiguous
// create-temp-dir-with-no-cleanup pattern the gate scans for.
const MECHANISM_EXAMPLES = {
  'a cleanup path on exit': {
    basename: 'bl1289_fixture_guarded.bb',
    body:
      '(def created-temp-dirs (atom []))\n' +
      '(.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (doseq [d @created-temp-dirs] (fs/delete-tree d)))))\n' +
      '(def d (let [dd (str (fs/create-temp-dir {:prefix "bl1289-fixture-"}))] (swap! created-temp-dirs conj dd) dd))\n',
  },
  'no cleanup path of any kind': {
    basename: 'bl1289_fixture_unguarded.bb',
    body: '(def d (str (fs/' + 'create-temp-dir {:prefix "bl1289-fixture-"})))\n',
  },
};

const VERDICT_EXAMPLES = {
  'reported as': true,
  'not reported as': false,
};

function knownMechanism(token) {
  if (!Object.prototype.hasOwnProperty.call(MECHANISM_EXAMPLES, token)) {
    throw new Error(`unknown <mechanism>: ${token}`);
  }
  return MECHANISM_EXAMPLES[token];
}

function knownVerdict(token) {
  if (!Object.prototype.hasOwnProperty.call(VERDICT_EXAMPLES, token)) {
    throw new Error(`unknown <verdict>: ${token}`);
  }
  return VERDICT_EXAMPLES[token];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the tempDirTrapGuard scan over swarmforge\/scripts$/, (ctx) => {
    ctx.bl1289 = { scanDir: SCRIPTS_DIR };
  });

  // ── Scenario Outline 01 ──────────────────────────────────────────────────
  scoped(/^a runner that creates a temp root with (.+)$/, (ctx, mechanism) => {
    const { basename, body } = knownMechanism(mechanism);
    ctx.bl1289.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1289-outline-'));
    ctx.bl1289.fixtureFile = path.join(ctx.bl1289.fixtureRoot, basename);
    fs.writeFileSync(ctx.bl1289.fixtureFile, body);
  });

  scoped(/^the guard scans it$/, (ctx) => {
    const text = fs.readFileSync(ctx.bl1289.fixtureFile, 'utf8');
    ctx.bl1289.violation = findTempDirTrapViolation(path.basename(ctx.bl1289.fixtureFile), text);
    fs.rmSync(ctx.bl1289.fixtureRoot, { recursive: true, force: true });
  });

  scoped(/^the runner is (.+) a violation$/, (ctx, verdictToken) => {
    const expectFlagged = knownVerdict(verdictToken);
    const flagged = Boolean(ctx.bl1289.violation);
    if (flagged !== expectFlagged) {
      throw new Error(`expected flagged=${expectFlagged} for ${ctx.bl1289.fixtureFile}, got: ${JSON.stringify(ctx.bl1289.violation)}`);
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^every runner under swarmforge\/scripts$/, (ctx) => {
    ctx.bl1289.scanDir = SCRIPTS_DIR;
  });

  scoped(/^the guard scans the tree$/, (ctx) => {
    ctx.bl1289.treeViolations = scanForTempDirTrapViolations(ctx.bl1289.scanDir);
  });

  scoped(/^it reports no violations at all$/, (ctx) => {
    if (ctx.bl1289.treeViolations.length > 0) {
      throw new Error(
        `expected zero violations under ${ctx.bl1289.scanDir}, found:\n` +
          ctx.bl1289.treeViolations.map((v) => `${v.file}: ${v.reason}`).join('\n')
      );
    }
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  // Drives the REAL fixture_isolation_reap - a stale root stamped with a
  // DEAD owner pid (the killed-run shape), never a live one this reap must
  // leave alone.
  scoped(/^a temp root left behind by a run that was killed$/, (ctx) => {
    const prefix = 'bl1289-killed-';
    ctx.bl1289.staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    // A pid guaranteed dead: spawn a real process and let it exit first.
    const dead = spawnSync('true', [], {});
    const deadPid = dead.pid;
    fs.writeFileSync(path.join(ctx.bl1289.staleRoot, '.fixture-owner-pid'), String(deadPid));
    ctx.bl1289.prefix = prefix;
  });

  scoped(/^a later run of the same runner starts$/, (ctx) => {
    const script =
      `source "${FIXTURE_ISOLATION_SH}"; ` +
      `fixture_isolation_reap "${ctx.bl1289.prefix}" 0`;
    const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    ctx.bl1289.reapResult = res;
  });

  scoped(/^that leftover root is gone before the run makes any assertion$/, (ctx) => {
    if (fs.existsSync(ctx.bl1289.staleRoot)) {
      throw new Error(
        `expected ${ctx.bl1289.staleRoot} (a killed run's leftover, dead-owner-pid-stamped) to be reaped before the ` +
          `next run, but it still exists. reap stderr: ${ctx.bl1289.reapResult.stderr}`
      );
    }
  });
}

module.exports = { registerSteps };
