'use strict';

// BL-1407: step handlers for "The property gate re-runs a red in isolation
// before it refuses". Drives the REAL check_property_suite_drift.sh as a
// subprocess against a real temp git repository - the same convention the
// sibling shell test (test_property_suite_drift_guard.sh) and BL-1403's own
// acceptance handler use for this guard family, since the defect lives in
// the guard's own shell/subprocess plumbing, not in anything a
// reimplementation could stand in for.
//
// The fake suite command tells the FULL run ($# == 0, invoked exactly as
// the guard's own "$@") from a RE-RUN (invoked with two extra args appended
// by the guard's run_rerun_for_file: a placeholder landing on $0, then the
// file being re-run landing on $1) purely by argument count - the same seam
// swarmforge/scripts/test/test_property_suite_drift_guard.sh's own BL-1407
// scenarios (19-22) use.
//
// Fixture roots come from mkProcessTmpDir: the acceptance runner has no
// Vitest afterEach, and a scenario's root is needed across multiple steps,
// so no single step can safely clean up early (BL-1385/BL-1390) - no
// prefix-glob sweep anywhere.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1407 The property gate re-runs a red in isolation before it refuses';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const root = mkProcessTmpDir('bl1407acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  return root;
}

function stageNonPropertyTrigger(root) {
  fs.mkdirSync(path.join(root, 'extension', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extension', 'src', 'pipelineBoard.ts'), 'v1\n');
  git(root, ['add', 'extension/src/pipelineBoard.ts']);
}

function runGuard(root, extraArgs, env) {
  try {
    const out = execFileSync('bash', [GUARD, ...extraArgs], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { allowed: true, output: out };
  } catch (err) {
    return { allowed: false, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function currentYearMonthUTC() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function flakeLogPath(root) {
  return path.join(root, '.swarmforge', 'property-flakes', `${currentYearMonthUTC()}.jsonl`);
}

function readFlakeRecords(root) {
  const p = flakeLogPath(root);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ensureCtx(ctx) {
  if (!ctx.bl1407) {
    ctx.bl1407 = { root: makeRepo() };
    stageNonPropertyTrigger(ctx.bl1407.root);
  }
  return ctx.bl1407;
}

// A single-file fake suite: fails on the full run, then behaves per
// `mode` on a re-run (invoked with $1 = the file being re-run).
function singleFileFakeSuite(file, mode) {
  const body =
    mode === 'passes'
      ? `if [ "$#" -eq 0 ]; then printf '%s\\n' ' FAIL  ${file} > x' >&2; exit 1; else exit 0; fi`
      : mode === 'hangs'
        ? `if [ "$#" -eq 0 ]; then printf '%s\\n' ' FAIL  ${file} > x' >&2; exit 1; else sleep 30; exit 0; fi`
        : `printf '%s\\n' ' FAIL  ${file} > x' >&2; exit 1`; // mode === 'fails'
  return ['bash', '-c', body];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the property-suite gate running against a staged commit that touches no property file$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^a non-allowlisted property file that fails in the full run and passes when run alone$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.file = 'test/bl1407AcceptanceFlaky.property.test.js';
    state.fakeArgs = singleFileFakeSuite(state.file, 'passes');
    state.env = {};
  });

  scoped(/^a non-allowlisted property file that fails in the full run and fails again when run alone$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.file = 'test/bl1407AcceptanceAlwaysRed.property.test.js';
    state.fakeArgs = singleFileFakeSuite(state.file, 'fails');
    state.env = {};
  });

  scoped(/^a non-allowlisted property file that fails in the full run and hangs when run alone$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.file = 'test/bl1407AcceptanceHang.property.test.js';
    state.fakeArgs = singleFileFakeSuite(state.file, 'hangs');
    state.env = { SWARMFORGE_PROPERTY_RERUN_CEILING_SECONDS: '1' };
  });

  scoped(/^three non-allowlisted property files that fail in the full run$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.threeFiles = [
      'test/bl1407AcceptanceA.property.test.js',
      'test/bl1407AcceptanceB.property.test.js',
      'test/bl1407AcceptanceC.property.test.js',
    ];
    state.counterLog = path.join(state.root, '..', `bl1407acc-counter-${process.pid}.log`);
    fs.rmSync(state.counterLog, { force: true });
  });

  scoped(/^one allowlisted property file that fails in the full run$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.ok(state.threeFiles, 'the three non-allowlisted files must be set up first');
    state.allowlistedFile = 'test/bl632CommitTimeGuardInvariants.property.test.js';
    const failLines = [...state.threeFiles, state.allowlistedFile]
      .map((f) => ` FAIL  ${f} > x`)
      .map((l) => `printf '%s\\n' '${l}' >&2;`)
      .join(' ');
    const body = `
if [ "$#" -eq 0 ]; then
  ${failLines}
  exit 1
else
  echo "$1" >> '${state.counterLog}'
  exit 1
fi`;
    state.fakeArgs = ['bash', '-c', body];
    state.env = {};
  });

  scoped(/^the gate decides$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.ok(state.fakeArgs, 'a Given step must configure the fake suite command first');
    state.result = runGuard(state.root, state.fakeArgs, state.env || {});
  });

  scoped(/^the commit is allowed$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.ok(state.result.allowed, `expected the commit to be allowed: ${state.result.output}`);
  });

  scoped(/^the commit is refused naming that file$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.ok(!state.result.allowed, `expected the commit to be refused: ${state.result.output}`);
    assert.match(
      state.result.output,
      new RegExp(state.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `refusal must name ${state.file}: ${state.result.output}`
    );
  });

  scoped(/^a flake record names the file, the commit, and that the commit did not touch the file$/, (ctx) => {
    const state = ensureCtx(ctx);
    const records = readFlakeRecords(state.root);
    const record = records.find((r) => r.file === state.file);
    assert.ok(record, `expected a flake record for ${state.file}, got: ${JSON.stringify(records)}`);
    assert.ok(typeof record.commit === 'string' && record.commit.length > 0, `expected a commit field: ${JSON.stringify(record)}`);
    assert.equal(record.touched_by_commit, false, `expected touched_by_commit=false: ${JSON.stringify(record)}`);
  });

  scoped(/^no flake record is written$/, (ctx) => {
    const state = ensureCtx(ctx);
    const records = readFlakeRecords(state.root);
    assert.equal(records.length, 0, `expected no flake records, got: ${JSON.stringify(records)}`);
  });

  scoped(/^each of the three files is re-run exactly once$/, (ctx) => {
    const state = ensureCtx(ctx);
    // The Given/When for this scenario share one guard invocation; run it
    // here if it has not run yet (this step follows both Givens directly).
    if (!state.result) {
      state.result = runGuard(state.root, state.fakeArgs, state.env || {});
    }
    const lines = fs.existsSync(state.counterLog)
      ? fs.readFileSync(state.counterLog, 'utf8').split('\n').filter(Boolean)
      : [];
    for (const f of state.threeFiles) {
      const count = lines.filter((l) => l === f).length;
      assert.equal(count, 1, `expected exactly one re-run of ${f}, got ${count}: ${JSON.stringify(lines)}`);
    }
    assert.equal(lines.length, 3, `expected exactly 3 total re-run invocations, got: ${JSON.stringify(lines)}`);
  });

  scoped(/^the allowlisted file is not re-run$/, (ctx) => {
    const state = ensureCtx(ctx);
    const lines = fs.existsSync(state.counterLog)
      ? fs.readFileSync(state.counterLog, 'utf8').split('\n').filter(Boolean)
      : [];
    assert.ok(
      !lines.includes(state.allowlistedFile),
      `the allowlisted file must never be re-run, got: ${JSON.stringify(lines)}`
    );
  });
}

module.exports = { registerSteps };
