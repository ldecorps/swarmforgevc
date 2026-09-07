'use strict';

// BL-1408: three shell tests (and one property fixture, gated elsewhere -
// see this ticket's own notes) stop pinning the commit-guard chain with a
// hand-written list and instead read it, at run time, through BL-1398's
// helper. Every scenario here drives the REAL shell test files against
// either the live chain or a scratch seam this handler builds itself -
// nothing greps a label, since the defect being closed is precisely a list
// that had quietly stopped agreeing with the chain it was supposed to mirror.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deriveCommitGuardFixtureSet } = require('../../../extension/test/helpers/commitGuardFixtureSet');

const FEATURE = 'BL-1408 The commit-guard tests derive their guard set from the chain they exercise';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_run_commit_guards.sh');
const MERGE_HOOK_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_pre_merge_commit_hook.sh');
const PIPELINE_CODE_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_pipeline_code_on_main_guard.sh');
const REAL_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'run_commit_guards.sh');
const REAL_CHAIN_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'commit_guard_chain_lib.sh');
const REAL_MERGE_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-merge-commit');

const EXTRA_RUNNER_GUARD = 'check_bl1408_extra_runner.sh';
const EXTRA_MERGE_GUARD = 'check_bl1408_extra_merge.sh';

function run(scriptPath, args) {
  const res = spawnSync('bash', [scriptPath, ...args], { encoding: 'utf8', timeout: 300000 });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

// Splices an extra `run_guard <name>` line in just before the FIRST line
// containing `marker` - for both chains that is the tier-1 early-exit
// check, so the spliced guard always runs on a clean commit (case 01/the
// seam scenarios here) without needing to also survive every refusal case
// the shell test drives. An append at EOF would land after the real
// runner's own unconditional `exit`, which is unreachable dead code.
function insertBeforeMarker(text, marker, extraLine) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes(marker));
  assert.ok(idx >= 0, `marker "${marker}" not found while building a seam`);
  lines.splice(idx, 0, extraLine);
  return lines.join('\n');
}

function mkScratchRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withScratchRoot(prefix, fn) {
  const root = mkScratchRoot(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A runner seam: the real run_commit_guards.sh plus one extra `run_guard`
// line, and a placeholder file for every guard it names (including the
// extra one) so deriveCommitGuardFixtureSet's existence check - the same
// one test_run_commit_guards.sh's own derive_guards() calls - does not
// refuse the seam for a guard that is only ever exercised via a stub.
function buildRunnerSeam(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const seamRunner = path.join(scriptsDir, 'run_commit_guards.sh');
  const withExtra = insertBeforeMarker(
    fs.readFileSync(REAL_RUNNER, 'utf8'),
    'if guard_chain_has_refusal',
    `run_guard ${EXTRA_RUNNER_GUARD}`
  );
  fs.writeFileSync(seamRunner, withExtra);
  fs.chmodSync(seamRunner, 0o755);
  fs.copyFileSync(REAL_CHAIN_LIB, path.join(scriptsDir, 'commit_guard_chain_lib.sh'));

  const { guards: realGuards } = deriveCommitGuardFixtureSet({ repoRoot: REPO_ROOT, hookRels: [] });
  for (const g of [...realGuards, EXTRA_RUNNER_GUARD]) {
    fs.writeFileSync(path.join(scriptsDir, g), '#!/usr/bin/env bash\nexit 0\n');
  }
  return seamRunner;
}

// A pre-merge-commit hook seam: the real hook plus one extra `run_guard`
// line, and its sourced chain lib beside it. test_pre_merge_commit_hook.sh
// derives its guard list via parseRunGuardEntries alone (a regex read, not
// a filesystem walk), so - unlike the runner seam - no guard placeholder
// files are needed here.
function buildMergeHookSeam(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  const hooksDir = path.join(root, 'swarmforge', 'git-hooks');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });

  fs.copyFileSync(REAL_CHAIN_LIB, path.join(scriptsDir, 'commit_guard_chain_lib.sh'));

  const seamHook = path.join(hooksDir, 'pre-merge-commit');
  const withExtra = insertBeforeMarker(
    fs.readFileSync(REAL_MERGE_HOOK, 'utf8'),
    'if guard_chain_has_refusal',
    `run_guard ${EXTRA_MERGE_GUARD}`
  );
  fs.writeFileSync(seamHook, withExtra);
  fs.chmodSync(seamHook, 0o755);
  return seamHook;
}

// Module scope, not per-ctx: the runtime gives each scenario its own ctx,
// so a per-ctx memo would re-run a shell suite once per scenario that
// shares it (BL-1398's own fixture handler notes the same shape).
const memo = {};
function once(key, fn) {
  if (!(key in memo)) memo[key] = fn();
  return memo[key];
}

function runnerRealResult() {
  return once('runnerReal', () => run(RUNNER_TEST, []));
}

function runnerSeamResult() {
  return once('runnerSeam', () => withScratchRoot('sfvc-bl1408-runner-seam-', (root) => run(RUNNER_TEST, [buildRunnerSeam(root)])));
}

function mergeSeamResult() {
  return once('mergeSeam', () => withScratchRoot('sfvc-bl1408-merge-seam-', (root) => run(MERGE_HOOK_TEST, [buildMergeHookSeam(root)])));
}

function pipelineCodeRealResult() {
  return once('pipelineCode', () => run(PIPELINE_CODE_TEST, []));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the real runner including the handler module graph and bb load guards$/, (ctx) => {
    ctx.bl1408 = ctx.bl1408 || {};
  });

  scoped(/^a runner seam that names an additional guard present on the seam tree$/, (ctx) => {
    ctx.bl1408 = ctx.bl1408 || {};
    ctx.bl1408.extraGuard = EXTRA_RUNNER_GUARD;
  });

  scoped(/^a pre-merge-commit hook seam that names an additional guard present on the seam tree$/, (ctx) => {
    ctx.bl1408 = ctx.bl1408 || {};
    ctx.bl1408.extraGuard = EXTRA_MERGE_GUARD;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the runner test runs$/, (ctx) => {
    ctx.bl1408.result = runnerRealResult();
  });

  scoped(/^the runner test runs against the seam$/, (ctx) => {
    ctx.bl1408.result = runnerSeamResult();
  });

  scoped(/^the pre-merge hook test runs against the seam$/, (ctx) => {
    ctx.bl1408.result = mergeSeamResult();
  });

  scoped(/^the pipeline-code guard test runs$/, (ctx) => {
    ctx.bl1408.result = pipelineCodeRealResult();
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the test passes every case$/, (ctx) => {
    const { status, out } = ctx.bl1408.result;
    assert.equal(status, 0, `expected exit 0, got ${status}:\n${out}`);
    assert.ok(!/^FAIL:/m.test(out), `expected no FAIL lines:\n${out}`);
  });

  scoped(/^it reports the additional guard among the stubs it derived$/, (ctx) => {
    const { out } = ctx.bl1408.result;
    assert.ok(
      out.includes(ctx.bl1408.extraGuard),
      `expected the derived-set diagnostic line to name ${ctx.bl1408.extraGuard}, got:\n${out}`
    );
  });

  scoped(/^it reports that every derived guard ran$/, (ctx) => {
    const { out } = ctx.bl1408.result;
    const expected = ctx.bl1408.extraGuard === EXTRA_MERGE_GUARD
      ? 'PASS: 01 a clean merge runs every derived guard and is allowed'
      : 'PASS: 01 a clean commit is allowed and every derived guard ran';
    assert.ok(out.includes(expected), `expected "${expected}" in:\n${out}`);
  });
}

module.exports = { registerSteps };
