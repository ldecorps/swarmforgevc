'use strict';

// BL-1570: step handlers for "BL-1570 The liveness-undetermined tests build
// the no-proc case on every host". Scenario 01 drives the two REAL shell
// test files as subprocesses (the fixture is the shell tests' own, this
// handler never re-implements their fixtures). Scenario 02 greps each FILE's
// undetermined tick for the SWARMFORGE_PROC_DIR / SWARMFORGE_LSOF_BIN seam
// rather than re-running their internal logic. Scenario 03 diffs the
// untouched lib against main, per the ticket's own "not in scope" list.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1570 The liveness-undetermined tests build the no-proc case on every host';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const TWO_FILES = [
  'test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh',
  'test_operator_runtime_sandbox_sweep_liveness_undetermined.sh',
];

function readTestFile(file) {
  return fs.readFileSync(path.join(SCRIPTS_TEST_DIR, file), 'utf8');
}

function runShellTest(file, opts = {}) {
  return spawnSync('bash', [path.join(SCRIPTS_TEST_DIR, file)], {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
  });
}

// The undetermined tick is the run_tick call whose lsof argument is a
// nonexistent path (as opposed to the sandbox-sweep file's control tick,
// whose lsof argument is the empty string "" - the real facility). Both
// files' undetermined call is a single line.
function undeterminedTickCallLine(src) {
  const calls = [...src.matchAll(/^run_tick\s+.+$/gm)].map((m) => m[0]);
  const undetermined = calls.filter((line) => !/^run_tick\s+"[^"]*"\s+"[^"]*"\s+""\s*$/.test(line));
  assert.equal(
    undetermined.length,
    1,
    `expected exactly one undetermined-tick run_tick call, found ${undetermined.length}:\n${calls.join('\n')}`,
  );
  return undetermined[0];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── liveness-undetermined-every-host-01 ──────────────────────────────────

  scoped(/^swarmforge\/scripts\/test\/(\S+) runs$/, (ctx, file) => {
    assert.ok(TWO_FILES.includes(file), `unexpected file named by the scenario: ${file}`);
    ctx.bl1570File = file;
    ctx.bl1570Run = runShellTest(file);
  });

  scoped(/^it prints ALL CHECKS PASSED and exits zero$/, (ctx) => {
    const out = `${ctx.bl1570Run.stdout || ''}${ctx.bl1570Run.stderr || ''}`;
    assert.equal(ctx.bl1570Run.status, 0, `${ctx.bl1570File} is still red:\n${out}`);
    assert.match(out, /ALL CHECKS PASSED/, `${ctx.bl1570File} did not report ALL CHECKS PASSED:\n${out}`);
  });

  // ── liveness-undetermined-every-host-02 ──────────────────────────────────

  scoped(/^the file swarmforge\/scripts\/test\/(\S+) is read$/, (ctx, file) => {
    assert.ok(TWO_FILES.includes(file), `unexpected file named by the scenario: ${file}`);
    ctx.bl1570File = file;
    ctx.bl1570Src = readTestFile(file);
    ctx.bl1570UndeterminedCall = undeterminedTickCallLine(ctx.bl1570Src);
  });

  scoped(/^its undetermined tick sets SWARMFORGE_PROC_DIR to a path that does not exist$/, (ctx) => {
    // The env var is applied by run_tick's function body keyed off a 4th
    // call argument (fixture-reaper file: unconditional; sandbox-sweep
    // file: conditional via the env-command seam, BL-801-style) - so the
    // seam is present only when the undetermined call carries that 4th arg.
    assert.match(
      ctx.bl1570Src,
      /SWARMFORGE_PROC_DIR/,
      `${ctx.bl1570File} never references SWARMFORGE_PROC_DIR`,
    );
    const argMatch = ctx.bl1570UndeterminedCall.match(/^run_tick\s+"[^"]*"\s+"[^"]*"\s+"[^"]*"\s+"([^"]+)"\s*$/);
    assert.ok(
      argMatch,
      `${ctx.bl1570File}'s undetermined tick does not pass a 4th (proc-dir) argument to run_tick: ${ctx.bl1570UndeterminedCall}`,
    );
    const procDirPath = argMatch[1];
    assert.ok(procDirPath.length > 0, `${ctx.bl1570File}'s proc-dir argument is empty`);
    // "does not exist": that literal path is never mkdir'd anywhere in the
    // file, so the fixture never brings it into being.
    assert.doesNotMatch(
      ctx.bl1570Src,
      new RegExp(`mkdir\\s+(-p\\s+)?"?${procDirPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`),
      `${ctx.bl1570File} creates its own claimed-nonexistent proc dir ${procDirPath}`,
    );
  });

  scoped(/^its undetermined tick sets SWARMFORGE_LSOF_BIN to a path that does not exist$/, (ctx) => {
    const argMatch = ctx.bl1570UndeterminedCall.match(/^run_tick\s+"[^"]*"\s+"[^"]*"\s+"([^"]+)"/);
    assert.ok(argMatch, `${ctx.bl1570File}'s undetermined tick call could not be parsed: ${ctx.bl1570UndeterminedCall}`);
    const lsofPath = argMatch[1];
    assert.ok(lsofPath.length > 0, `${ctx.bl1570File}'s lsof argument is empty (that is the control tick, not undetermined)`);
    assert.doesNotMatch(
      ctx.bl1570Src,
      new RegExp(`mkdir\\s+(-p\\s+)?"?${lsofPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`),
      `${ctx.bl1570File} creates its own claimed-nonexistent lsof path ${lsofPath}`,
    );
  });

  // ── liveness-undetermined-every-host-03 ──────────────────────────────────

  scoped(/^swarmforge\/scripts\/proc_fd_scan_lib\.bb on the tree as it stands is compared with main$/, (ctx) => {
    ctx.bl1570Diff = spawnSync('git', ['diff', 'main', '--', 'swarmforge/scripts/proc_fd_scan_lib.bb'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  });

  scoped(/^it is unchanged$/, (ctx) => {
    assert.equal(ctx.bl1570Diff.status, 0, `git diff failed: ${ctx.bl1570Diff.stderr}`);
    assert.equal(
      ctx.bl1570Diff.stdout.trim(),
      '',
      `swarmforge/scripts/proc_fd_scan_lib.bb differs from main:\n${ctx.bl1570Diff.stdout}`,
    );
  });
}

module.exports = { registerSteps };
