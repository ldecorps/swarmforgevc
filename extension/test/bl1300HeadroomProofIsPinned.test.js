const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1300: BL-1227 scenario 02 is a ONE-TIME headroom proof — "the fix lands
// with real headroom, so the next amendment does not immediately breach" —
// and its Given reads "the repository at the BL-1227 fix commit". The handler
// bound that Given to `root = undefined` (the live working tree), so the proof
// became a standing 42000-char ceiling while the gate, the standing runner and
// scenario 03's own report all name 44000. Two live numbers, and the stricter
// one is invisible: an author trimming to 43000 is told the budget is 44000
// and refused anyway.
//
// This test pins the behaviour the Given already claims: the composed size
// those scenarios measure is the FIX COMMIT's size, not today's.

// BL-1066: under a Stryker sandbox this file runs from
// `.stryker-tmp/sandbox-<id>/test/`, where the sandbox dir IS the extension
// root rather than a child of one - a fixed `../..` walk-up lands one level
// too shallow, inside `.stryker-tmp` itself rather than the real repo root.
// The `swarmforge/` sibling symlink (ensureStrykerSandboxSiblingLinks) would
// paper over a PLAIN fs read at that shallow root, but `git archive` below
// resolves its pathspec relative to `-C`'s cwd within the TRACKED tree, not
// through those symlinks, so a REPO_ROOT of `.stryker-tmp` makes every
// pathspec miss ("pathspec '...' did not match any files") regardless of
// sandbox nesting depth.
//
// `git rev-parse --show-toplevel` is otherwise the WRONG general fix for
// this class (specifier correction, rule_proposal accepted-with-fix-amended
// 2026-09-02): it always answers the true repo root and can silently spare
// every mutant in code reached through it. It is safe HERE specifically,
// verified per-usage rather than assumed: everything REPO_ROOT reaches in
// this file is DATA Stryker never mutates - `git archive` below extracts
// `BL1227_FIX_COMMIT`, an IMMUTABLE past commit unrelated to any current
// mutation, and GATE_SH is a plain bash script (Stryker's `--mutate` scopes
// only `out/**/*.js`, never `swarmforge/scripts/*.sh`). Contrast
// `activePoolFreshnessAudit.test.js`, where this same fix would be wrong:
// it spawns the compiled, mutatable CLI itself as a subprocess.
const REPO_ROOT = execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const GATE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'boot_prefix_budget_gate.sh');

const { createStepRegistry } = require('../../specs/pipeline/stepRegistry');
const {
  registerSteps,
  FEATURE,
  BL1227_FIX_COMMIT,
  COMPOSER_INPUT_PATHS,
  sweepStaleFixTrees,
  STALE_FIX_TREE_MS,
} = require('../../specs/pipeline/steps/bl1227BootPrefixLiveBudgetCheckSteps');

function freshRegistry() {
  const registry = createStepRegistry();
  registerSteps(registry);
  return registry;
}

function resolveAndRun(registry, ctx, stepText) {
  const resolved = registry.resolve(stepText, FEATURE);
  if (!resolved) {
    throw new Error(`no step handler matched "${stepText}"`);
  }
  return resolved.handler(ctx, ...resolved.args);
}

function measureWithGate(root) {
  const result = spawnSync('bash', [GATE_SH, ...(root ? [root] : [])], { encoding: 'utf8' });
  const m = (result.stdout || '').match(/(\d+)\/\d+ chars/);
  if (!m) {
    throw new Error(`could not parse gate output: ${result.stdout}${result.stderr}`);
  }
  return Number(m[1]);
}

// An independent second opinion on the fix commit's size: this test extracts
// the composer's inputs itself rather than trusting the handler's copy.
function measureFixCommitIndependently() {
  const dir = mkTmpDir('bl1300-independent-');
  try {
    const archive = execFileSync(
      'git',
      ['-C', REPO_ROOT, 'archive', BL1227_FIX_COMMIT, ...COMPOSER_INPUT_PATHS],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
    );
    execFileSync('tar', ['-x', '-C', dir], { input: archive });
    return measureWithGate(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the BL-1227 fix-commit Given binds a pinned tree, not the live working tree', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, "the stable boot prefix is composed through prompt-engine-lib's own composer");
  resolveAndRun(registry, ctx, 'the repository at the BL-1227 fix commit');

  assert.ok(
    typeof ctx.bl1227.root === 'string' && ctx.bl1227.root.length > 0,
    'expected the fix-commit Given to bind a materialized tree; `undefined` means it measures the live repo'
  );
  assert.notEqual(
    fs.realpathSync(ctx.bl1227.root),
    REPO_ROOT,
    'expected a tree other than the live repository root'
  );
});

test('what the fix-commit scenarios measure is the fix commit size, not today\'s', () => {
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, "the stable boot prefix is composed through prompt-engine-lib's own composer");
  resolveAndRun(registry, ctx, 'the repository at the BL-1227 fix commit');
  resolveAndRun(registry, ctx, 'the stable prefix is composed from the real repository tree');

  assert.equal(
    ctx.bl1227.measured,
    measureFixCommitIndependently(),
    'the measured size must be the fix commit\'s, so the 42000 headroom proof cannot drift into a live ceiling'
  );
});

test('the pinned headroom proof still proves headroom at the fix commit', () => {
  // The proof itself is unchanged in substance: the fix commit did land with
  // room to spare. What changes is that it proves it about a fixed tree, so
  // later growth into 42001..44000 - legal by every number the swarm reports -
  // is no longer vetoed by an assertion nobody reads as a budget.
  const registry = freshRegistry();
  const ctx = {};
  resolveAndRun(registry, ctx, "the stable boot prefix is composed through prompt-engine-lib's own composer");
  resolveAndRun(registry, ctx, 'the repository at the BL-1227 fix commit');
  resolveAndRun(registry, ctx, 'the stable prefix is composed from the real repository tree');

  assert.ok(ctx.bl1227.measured <= 42000, `fix commit measured ${ctx.bl1227.measured}, expected <= 42000`);
  assert.equal(ctx.bl1227.result.status, 0, 'the fix commit is under the 44000 budget too');
});

// Every role worktree shares one os.tmpdir() and several run this feature at
// once, so the BL-971 pre-run sweep must not collect a SIBLING run's live
// pinned tree - only genuine leftovers of a killed run.
test('the stale-tree sweep spares a fresh sibling run and collects an old leftover', () => {
  const fresh = mkTmpDir('bl1227-fix-commit-');
  const old = mkTmpDir('bl1227-fix-commit-');
  const longAgo = Date.now() - STALE_FIX_TREE_MS - 60_000;
  fs.utimesSync(old, longAgo / 1000, longAgo / 1000);

  sweepStaleFixTrees();

  assert.ok(fs.existsSync(fresh), 'a concurrent run\'s pinned tree must survive the sweep');
  assert.ok(!fs.existsSync(old), 'a leftover older than the staleness window must be collected');
});
