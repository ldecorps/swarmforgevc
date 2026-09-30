'use strict';

// BL-1665: step handlers for "A shell test under pipefail never feeds
// grep -q through a pipe, and a guard keeps it so". Drives the REAL
// swarmforge/scripts/check_shell_test_early_exit_pipe.sh through the REAL
// pre-commit hook (installed via core.hooksPath, same fixture pattern as
// bl632CommitTimeGuardSteps.js / bl1671MergeDeletionGuardReadsTheIndexSteps.js)
// as real `git commit` subprocesses - never a parallel reimplementation
// of the guard's decision logic. Scenario 04 drives the guard's own
// `--scan-tree` mode against the REAL repository tree, not a fixture -
// the census must see the whole population (BL-1445).
//
// Handler lands in the SAME commit as the feature (BL-233, BL-1371).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1665 A shell test under pipefail never feeds grep -q through a pipe, and a guard keeps it so';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_shell_test_early_exit_pipe.sh');

const {
  deriveCommitGuardFixtureSet,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js'));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// Every Examples: column value must be load-bearing (engineering.prompt):
// an unknown value fails the step outright rather than flowing through a
// passthrough/no-op branch.
const CONSUMER_LINES = new Map([
  ['grep -q needle', 'printf \'%s\\n\' "$OUT" | grep -q needle'],
  ['grep -qiE needle-pattern', 'printf \'%s\\n\' "$OUT" | grep -qiE needle-pattern'],
]);

const ASSERTION_LINES = new Map([
  ['a pipe into grep needle redirected to dev-null', 'printf \'%s\\n\' "$OUT" | grep needle >/dev/null'],
  ['a bash pattern test on the captured output', '[[ "$OUT" == *needle* ]]'],
]);

function mkFixtureRepo() {
  const root = trackedTmpRoot('sfvc-bl1665-acceptance-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');

  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'git-hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts', 'test'), { recursive: true });
  // A guard the runner names but the tree lacks THROWS here, naming it
  // (invariant 2): a fixture that quietly skipped it would run a chain
  // narrower than production and still report the scenario green.
  for (const rel of deriveCommitGuardFixtureSet({ repoRoot: REPO_ROOT }).files) {
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dst);
    fs.chmodSync(dst, 0o755);
  }
  // check_feature_handler_registration.sh (Tier-1 chain sibling) resolves
  // its compiled checker relative to its own script dir and reads the step
  // registry - both need to exist in the fixture for it to pass cleanly,
  // same pattern as bl632CommitTimeGuardSteps.js's fixture.
  fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'pipeline', 'steps', 'index.js'), 'module.exports = [];\n');
  fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
  try {
    fs.symlinkSync(path.join(REPO_ROOT, 'extension', 'out'), path.join(root, 'extension', 'out'), 'dir');
  } catch {
    // A checker the guard cannot resolve is a refusal naming the reason
    // (BL-1303 fails closed) - never a false pass.
  }
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed hooks');
  git(root, 'config', 'core.hooksPath', 'swarmforge/git-hooks');
  return root;
}

// Builds a test file's content with an explicit line map, so the exact
// line number a step asserts on is derived, never hand-counted.
function buildTestFile({ pipefail, statement }) {
  const lines = ['#!/usr/bin/env bash'];
  if (pipefail) lines.push('set -euo pipefail');
  lines.push('fail() { echo "FAIL: $1"; exit 1; }');
  lines.push('OUT="$(printf \'one\\ntwo\\nneedle\\n\')"');
  const statementLine = lines.length + 1;
  lines.push(`${statement} || fail "needle missing: $OUT"`);
  lines.push('echo pass');
  return { content: `${lines.join('\n')}\n`, statementLine };
}

function writeStagedTestFile(ctx, relName, built) {
  const relPath = `swarmforge/scripts/test/${relName}`;
  const full = path.join(ctx.root, relPath);
  fs.writeFileSync(full, built.content);
  fs.chmodSync(full, 0o755);
  git(ctx.root, 'add', relPath);
  ctx.bl1665 = ctx.bl1665 || {};
  ctx.bl1665.relPath = relPath;
  ctx.bl1665.statementLine = built.statementLine;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture repository under a temporary directory with the commit guard chain installed$/, (ctx) => {
    ctx.root = mkFixtureRepo();
    assert.equal(git(ctx.root, 'status', '--porcelain'), '', 'expected the freshly built fixture to be clean');
  });

  // ── Scenario 01 (refused) ───────────────────────────────────────────
  scoped(
    /^a staged shell test under swarmforge\/scripts\/test that sets pipefail and pipes a captured output into (.+)$/,
    (ctx, consumer) => {
      assert.ok(CONSUMER_LINES.has(consumer), `unknown <consumer> example value: ${consumer}`);
      const built = buildTestFile({ pipefail: true, statement: CONSUMER_LINES.get(consumer) });
      writeStagedTestFile(ctx, 'test_bl1665_refused_probe.sh', built);
    }
  );

  scoped(/^the commit is refused naming the file and the line number$/, (ctx) => {
    const { relPath, statementLine } = ctx.bl1665;
    assert.notEqual(ctx.bl1665.rc, 0, `expected the commit to be refused, got exit 0: ${ctx.bl1665.out}`);
    const combined = `${ctx.bl1665.out}${ctx.bl1665.err}`;
    assert.ok(combined.includes(relPath), `expected the refusal to name ${relPath}, got: ${combined}`);
    assert.ok(
      combined.includes(`${relPath}:${statementLine}:`),
      `expected the refusal to name line ${statementLine}, got: ${combined}`
    );
  });

  // ── Scenario 02 (accepted, whole-input consumer) ───────────────────
  scoped(
    /^a staged shell test under swarmforge\/scripts\/test that sets pipefail and asserts with (.+)$/,
    (ctx, assertion) => {
      assert.ok(ASSERTION_LINES.has(assertion), `unknown <assertion> example value: ${assertion}`);
      const built = buildTestFile({ pipefail: true, statement: ASSERTION_LINES.get(assertion) });
      writeStagedTestFile(ctx, 'test_bl1665_accepted_probe.sh', built);
    }
  );

  // ── Scenario 03 (accepted, no pipefail) ─────────────────────────────
  scoped(
    /^a staged shell test under swarmforge\/scripts\/test that never sets pipefail and pipes a captured output into grep -q needle$/,
    (ctx) => {
      const built = buildTestFile({ pipefail: false, statement: CONSUMER_LINES.get('grep -q needle') });
      writeStagedTestFile(ctx, 'test_bl1665_no_pipefail_probe.sh', built);
    }
  );

  // ── shared When ──────────────────────────────────────────────────────
  scoped(/^the commit runs the guard chain$/, (ctx) => {
    const result = spawnSync('git', ['commit', '-q', '-m', 'add probe test'], {
      cwd: ctx.root,
      encoding: 'utf8',
    });
    ctx.bl1665 = ctx.bl1665 || {};
    ctx.bl1665.rc = result.status ?? 1;
    ctx.bl1665.out = result.stdout || '';
    ctx.bl1665.err = result.stderr || '';
  });

  scoped(/^the commit is accepted$/, (ctx) => {
    assert.equal(
      ctx.bl1665.rc,
      0,
      `expected the commit to be accepted, got exit ${ctx.bl1665.rc}: ${ctx.bl1665.out}${ctx.bl1665.err}`
    );
  });

  // ── Scenario 04 (real-tree census) ──────────────────────────────────
  scoped(/^the guard scans every shell test under swarmforge\/scripts\/test$/, (ctx) => {
    const result = spawnSync('bash', [GUARD_SCRIPT, '--scan-tree'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    ctx.bl1665 = ctx.bl1665 || {};
    ctx.bl1665.rc = result.status ?? 1;
    ctx.bl1665.out = result.stdout || '';
    ctx.bl1665.err = result.stderr || '';
  });

  scoped(/^it names no file$/, (ctx) => {
    assert.equal(
      ctx.bl1665.rc,
      0,
      `expected the real-tree scan to find no violation, got exit ${ctx.bl1665.rc}: ${ctx.bl1665.out}${ctx.bl1665.err}`
    );
  });

  scoped(/^it reports having scanned at least 400 files$/, (ctx) => {
    const match = /scanned (\d+) file/.exec(ctx.bl1665.out);
    assert.ok(match, `expected a "scanned N file(s)" line, got: ${ctx.bl1665.out}`);
    const scanned = Number(match[1]);
    assert.ok(scanned >= 400, `expected at least 400 files scanned, got ${scanned}`);
  });
}

module.exports = { registerSteps };
