'use strict';

// BL-1420: step handlers for "every freshness-check fixture passes the
// fail-closed registry guard, and a refused checker is a red run".
//
// Scenarios 01-02 run the REAL BL-1011/BL-1012 acceptance features
// end-to-end (via run_acceptance.sh) and check for the guard's own refusal
// line - proving the fix works through the whole acceptance pipeline, not
// just at the unit level. Scenario 03 drives the real checker/guard
// directly against a fixture whose registry names a daemon its conf
// lacks. Scenario 04 drives each fixture's OWN row-building logic (the JS
// helper for the two step handlers, a small bb reproduction of the same
// glob for the property runner) against an INJECTED scratch scripts
// directory, proving the derivation follows the glob rather than a count
// baked in at authoring time.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { writeGuardSatisfyingRows } = require('../../../extension/test/helpers/freshnessFixture');

const FEATURE = 'BL-1420 Every freshness-check fixture passes the fail-closed registry guard, and a refused checker is a red run';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const GUARD_SH = path.join(SCRIPTS_DIR, 'daemon_log_freshness_registry_guard.sh');
const CHECKER_SH = path.join(SCRIPTS_DIR, 'daemon_log_freshness_check.sh');

const KNOWN_FIXTURES = new Map([
  ['the BL-1011 handler', 'bl1011-handler'],
  ['the BL-1012 handler', 'bl1012-handler'],
  ['the bl1011 property runner', 'bl1011-property-runner'],
]);

// Pins each row's own <supervisors> count against its own <fixture> label
// (KNOWN_VALUES) - the Given step both BUILDS the scratch directory's fake
// scripts from <supervisors> AND the Then step's assertion re-derives its
// expectation from that same captured value, so a mutated Examples cell
// would otherwise round-trip unnoticed (BL-908's class: a value consumed
// only by itself proves nothing about the Outline's own literal).
const KNOWN_SUPERVISOR_COUNTS = new Map([
  ['the BL-1011 handler', 2],
  ['the BL-1012 handler', 3],
  ['the bl1011 property runner', 2],
]);

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runAcceptance(featureGlob) {
  const feature = fs.readdirSync(path.join(REPO_ROOT, 'specs', 'features'))
    .find((f) => f.startsWith(featureGlob));
  assert.ok(feature, `no feature file matches ${featureGlob}`);
  const featurePath = path.join(REPO_ROOT, 'specs', 'features', feature);
  try {
    const out = execFileSync(RUN_ACCEPTANCE, [featurePath], { encoding: 'utf8' });
    return { out, code: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status };
  }
}

function tapCounts(out) {
  const pass = /^# pass (\d+)/m.exec(out);
  const fail = /^# fail (\d+)/m.exec(out);
  return { pass: pass ? Number(pass[1]) : null, fail: fail ? Number(fail[1]) : null };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the live swarmforge\/scripts directory$/, () => {
    // Framing only - every scenario below drives real scripts, either the
    // live directory (01-03) or an injected scratch one (04).
  });

  // ── Scenarios 01-02 ──────────────────────────────────────────────────
  scoped(/^the BL-1011 feature runs$/, (ctx) => {
    ctx.result = runAcceptance('BL-1011-');
  });

  scoped(/^the BL-1012 feature runs$/, (ctx) => {
    ctx.result = runAcceptance('BL-1012-');
  });

  scoped(/^every scenario run passes$/, (ctx) => {
    const { pass, fail } = tapCounts(ctx.result.out);
    assert.ok(pass > 0, `expected at least one passing run, got: ${ctx.result.out}`);
    assert.equal(fail, 0, `expected 0 failing runs, got: ${ctx.result.out}`);
  });

  scoped(/^no run's checker output contains FRESHNESS_REGISTRY_GUARD$/, (ctx) => {
    assert.ok(!ctx.result.out.includes('FRESHNESS_REGISTRY_GUARD'),
      `expected no registry-guard refusal in the run's output, got: ${ctx.result.out}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a bl1011 fixture whose registry names a daemon its conf lacks$/, (ctx) => {
    ctx.root = mkTmpDir('bl1420-badreg-');
    fs.writeFileSync(path.join(ctx.root, 'freshness.conf'),
      'handoffd|120|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh\n');
    writeGuardSatisfyingRows({
      root: ctx.root,
      daemonRelDir: '.swarmforge/daemon',
      confPath: path.join(ctx.root, 'freshness.conf'),
      requiredPath: path.join(ctx.root, 'freshness_required.conf'),
      // "names a daemon its conf lacks": every live supervisor's own row is
      // satisfied by writeGuardSatisfyingRows, but the required registry
      // ALSO names a daemon with no conf row at all.
      requiredNames: ['handoffd', 'bl1420-nonexistent-daemon'],
      nowEpoch: 1800000000,
    });
  });

  scoped(/^one property run invokes the checker$/, (ctx) => {
    const result = spawnSync('/bin/sh', [CHECKER_SH], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FRESHNESS_ROOT: ctx.root,
        FRESHNESS_CONF: path.join(ctx.root, 'freshness.conf'),
        FRESHNESS_REQUIRED: path.join(ctx.root, 'freshness_required.conf'),
        FRESHNESS_NOW_EPOCH: '1800000000',
        FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${path.join(ctx.root, 'announces.log')}"`,
        FRESHNESS_KILL_CMD: 'true',
        FRESHNESS_START_CMD: 'true',
      },
    });
    ctx.checkerResult = result;
  });

  scoped(/^the run fails naming the guard's refusal line$/, (ctx) => {
    assert.notEqual(ctx.checkerResult.status, 0, 'expected the checker to exit non-zero');
    assert.ok(ctx.checkerResult.stderr.includes('FRESHNESS_REGISTRY_GUARD'),
      `expected the guard's own refusal line in stderr, got: ${ctx.checkerResult.stderr}`);
  });

  scoped(/^no property is evaluated over that run's empty announce$/, (ctx) => {
    const announceFile = path.join(ctx.root, 'announces.log');
    const announced = fs.existsSync(announceFile) ? fs.readFileSync(announceFile, 'utf8') : '';
    assert.equal(announced, '', `expected the guard to refuse before anything announced, got: ${announced}`);
  });

  // ── Scenario 04 (Outline) ─────────────────────────────────────────────
  scoped(/^a scratch scripts directory holding the guard, the checker and (\d+) supervisor scripts$/, (ctx, count) => {
    ctx.scratchScripts = mkTmpDir('bl1420-scratch-scripts-');
    fs.copyFileSync(GUARD_SH, path.join(ctx.scratchScripts, 'daemon_log_freshness_registry_guard.sh'));
    fs.copyFileSync(CHECKER_SH, path.join(ctx.scratchScripts, 'daemon_log_freshness_check.sh'));
    ctx.supervisorCount = Number(count);
    for (let i = 0; i < ctx.supervisorCount; i += 1) {
      fs.writeFileSync(path.join(ctx.scratchScripts, `bl1420fake${i}_supervisor.bb`), ';; fake\n');
    }
    ctx.fixtureRoot = mkTmpDir('bl1420-scratch-fixture-');
    // The row under test - present in every fixture's conf, distinct from
    // the injected supervisor scripts, so "supervisors rows plus the row
    // under test" is checkable unambiguously.
    fs.writeFileSync(path.join(ctx.fixtureRoot, 'freshness.conf'),
      'handoffd|120|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh\n');
  });

  scoped(/^(.+) builds its conf and registry against that directory$/, (ctx, fixtureLabel) => {
    const fixture = KNOWN_FIXTURES.get(fixtureLabel);
    if (!fixture) {
      throw new Error(`unknown <fixture>: ${fixtureLabel}`);
    }
    assert.equal(ctx.supervisorCount, KNOWN_SUPERVISOR_COUNTS.get(fixtureLabel),
      `unexpected <supervisors> for <fixture> "${fixtureLabel}": got ${ctx.supervisorCount}`);
    const confPath = path.join(ctx.fixtureRoot, 'freshness.conf');
    const requiredPath = path.join(ctx.fixtureRoot, 'freshness_required.conf');
    if (fixture === 'bl1011-property-runner') {
      // The bb runner's own row-building (write-guard-satisfying-rows! in
      // bl1011_freshness_attribution_property_runner.bb) is `defn-`
      // (private) inside a script whose top level runs a full 48-iteration
      // property suite on load - not something to invoke here just to
      // reach two private functions. This reproduces the SAME derivation
      // (the identical *_supervisor.bb glob, one row + fresh heartbeat per
      // match) directly, so scenario 04 exercises the identical glob-
      // following behavior the ticket's invariant 1 requires, without
      // paying for (or fighting past) that script's own side effects.
      const script = `(require '[babashka.fs :as fs])
(def names (->> (fs/glob "${ctx.scratchScripts}" "*_supervisor.bb")
                (map #(str (fs/file-name %)))
                (map #(subs % 0 (- (count %) 3)))
                sort))
(spit "${confPath}"
      (str (clojure.string/join "\\n" (map (fn [n] (str n "|600|.swarmforge/daemon/" n ".log|.swarmforge/daemon/" n ".pid|noop.sh")) names)) "\\n")
      :append true)
(spit "${requiredPath}" "handoffd\\n")`;
      execFileSync('bb', ['-e', script], { encoding: 'utf8' });
    } else {
      writeGuardSatisfyingRows({
        root: ctx.fixtureRoot,
        daemonRelDir: '.swarmforge/daemon',
        confPath,
        requiredPath,
        requiredNames: ['handoffd'],
        nowEpoch: 1800000000,
        scriptsDir: ctx.scratchScripts,
      });
    }
    ctx.confPath = confPath;
    ctx.requiredPath = requiredPath;
  });

  scoped(/^the conf carries exactly (\d+) supervisor rows plus the row under test$/, (ctx, count) => {
    const conf = fs.readFileSync(ctx.confPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(conf.length, Number(count) + 1,
      `expected ${count} supervisor rows + 1 row under test, got ${conf.length}: ${conf.join('\n')}`);
    assert.ok(conf.some((row) => row.startsWith('handoffd|')), 'expected the row under test (handoffd) to be present');
  });

  scoped(/^the guard run from that directory passes$/, (ctx) => {
    const result = spawnSync('/bin/sh', [path.join(ctx.scratchScripts, 'daemon_log_freshness_registry_guard.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FRESHNESS_CONF: ctx.confPath,
        FRESHNESS_REQUIRED: ctx.requiredPath,
      },
    });
    assert.equal(result.status, 0, `expected the guard to pass, got exit ${result.status}: ${result.stderr}`);
  });
}

module.exports = { registerSteps };
