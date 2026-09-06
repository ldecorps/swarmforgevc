'use strict';

// BL-1444: step handlers for "the Art Director's docs/design tip lands on
// main by QA on its note". Drives the REAL
// swarmforge/scripts/check_art_director_tip.sh through the REAL
// pre-merge-commit hook chain (installed via core.hooksPath, the mkFixtureRepo
// shape in bl632CommitTimeGuardSteps.js) as real `git merge --no-ff`
// subprocesses, plus direct-mode `--tip` invocations of the same script -
// never a parallel reimplementation of the guard's decision logic.
//
// The fixture's guard set is derived from pre-merge-commit's OWN run_guard
// lines only (BL-1398/BL-1401 posture) - this feature never exercises
// `git commit` (pre-commit's chain), only `git merge --no-ff`, so the
// fixture carries exactly what that one hook runs: check_pipeline_code_on_main.sh,
// check_feature_handler_registration.sh and check_art_director_tip.sh, plus
// whatever they source. Landing and role branches are non-`main` branches
// throughout, so check_pipeline_code_on_main.sh and
// check_feature_handler_registration.sh stay out of the way, as in
// production (QA lands from swarmforge-QA).
//
// All registrations are defineScoped pinned to this feature's exact title
// (BL-425): step texts here are shared across several scenarios in this one
// feature file on purpose, but must never resolve for an unrelated feature.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = "the Art Director's docs/design tip lands on main by QA on its note";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_art_director_tip.sh');

// Every Examples: column value must be load-bearing (engineering.prompt): an
// unknown (e.g. gherkin-mutator-mutated) value fails the step outright
// instead of flowing through a passthrough/no-op branch.
const KNOWN_LANE_PATHS = new Set([
  'docs/design/briefs/2026-09-06-briefing-list-item-scan-weight.md',
  'docs/design/system.md',
  'backlog/evidence/BL-1419-art-director-20260906.md',
  'docs/design/artifact-inventory.md',
]);
const KNOWN_OUT_OF_LANE_PATHS = new Set([
  'extension/src/tools/render-briefing-diagrams.ts',
  'swarmforge/scripts/briefing_email_lib.bb',
  'docs/how-to/BL-1418-the-art-director-seat-is-addressable.md',
  'backlog/evidence/BL-1419-qa-pass-20260905.md',
  'backlog/paused/BL-1442-briefing-list-item-leading-ticket-id-is-bold.yaml',
  'extension/src/tools/telegram-front-desk-bot.ts',
]);
const KNOWN_TIP_PATHS = new Set([...KNOWN_LANE_PATHS, ...KNOWN_OUT_OF_LANE_PATHS]);
const KNOWN_VERDICTS = new Set(['ART_DIRECTOR_TIP_OK', 'ART_DIRECTOR_TIP_REFUSED']);
const KNOWN_EXITS = new Set(['0', '1']);

const {
  deriveCommitGuardFixtureSet,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js'));

// BL-1398/BL-1401 posture applied narrowly: derive from the ONE hook this
// feature exercises, not the whole pre-commit chain too - a hand list would
// go stale exactly the way BL-1385/BL-1395 already did for the wider one.
//
// BL-968: computed LAZILY, on first use inside mkFixtureRepo() - never at
// module load time. A step handler file is `require`d by discovery
// (specs/pipeline/steps/index.js) and, separately, materialized into
// isolated copies by other tests (e.g.
// bl968MaterializedGuardSensitivity.property.test.js) that do not carry
// this repo's full tree beside it; a module-level call here would resolve
// REPO_ROOT's git-hooks/scripts tree the moment the file is merely loaded,
// crashing every such caller before any scenario runs.
let fixtureSetCache = null;
function getFixtureSet() {
  if (!fixtureSetCache) {
    fixtureSetCache = deriveCommitGuardFixtureSet({
      repoRoot: REPO_ROOT,
      runnerRel: 'swarmforge/git-hooks/pre-merge-commit',
      hookRels: ['swarmforge/git-hooks/pre-merge-commit'],
    });
  }
  return fixtureSetCache;
}

// Fixture-root hygiene (BL-459's acceptance sibling): every root the
// Background creates is registered for removal at process exit, so neither a
// passing nor a throwing scenario leaves a repo behind.
const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeAndAdd(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content || `${relPath}\n`);
  git(root, 'add', relPath);
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1444-acceptance-'));
  fixtureRoots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  // Repo-LOCAL identity (BL-459/bl632 convention): a fixture that relies on
  // the host having a global identity aborts with "Author identity unknown"
  // before any hook runs.
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');

  // A guard the hook names but the tree lacks THROWS at derive time, naming
  // it (deriveCommitGuardFixtureSet's own invariant): a fixture that
  // quietly skipped it would run a chain narrower than production and still
  // report the scenario green.
  for (const rel of getFixtureSet().files) {
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dst);
    fs.chmodSync(dst, 0o755);
  }
  // An EMPTY step registry, so check_feature_handler_registration.sh asks
  // its real question of this fixture - nothing here is unrunnable -
  // instead of refusing because a tree with no acceptance pipeline has no
  // registry to read.
  fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'pipeline', 'steps', 'index.js'), 'module.exports = [];\n');
  // check_feature_handler_registration.sh resolves its compiled checker
  // relative to its OWN script dir, so the fixture's copy needs the real out
  // tree beside it. A symlink, never a copy - the tree is large.
  fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
  try {
    fs.symlinkSync(path.join(REPO_ROOT, 'extension', 'out'), path.join(root, 'extension', 'out'), 'dir');
  } catch {
    // A checker the guard cannot resolve is a refusal naming the reason
    // (BL-1303 fails closed) - never a false pass.
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed hooks');
  git(root, 'config', 'core.hooksPath', 'swarmforge/git-hooks');

  git(root, 'branch', 'primary/art-director', 'main');
  return root;
}

function mergeWithNoFf(ctx, targetBranch, ref, message) {
  git(ctx.root, 'checkout', '-q', targetBranch);
  const result = spawnSync('git', ['merge', '--no-ff', '-q', '-m', message, ref], {
    cwd: ctx.root,
    encoding: 'utf8',
  });
  ctx.mergeResult = { rc: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
  if (ctx.mergeResult.rc !== 0) {
    // A refused pre-merge-commit hook leaves MERGE_HEAD and the staged merge
    // in place (git only declines the commit, it does not roll the merge
    // back itself) - abort so the fixture is clean for the Then steps that
    // read branch tips afterward.
    spawnSync('git', ['merge', '--abort'], { cwd: ctx.root });
  }
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a fixture repository with a main branch, the versioned pre-merge-commit hook chain, and a branch primary\/art-director based on main$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
    },
    FEATURE
  );

  registry.defineScoped(/^a landing branch checked out at main's tip$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', '-b', 'landing', 'main');
    ctx.landingBranch = 'landing';
    ctx.landingTipBefore = git(ctx.root, 'rev-parse', 'HEAD');
  }, FEATURE);

  // ── shared Givens ───────────────────────────────────────────────────────
  // Both Givens below restore HEAD to the landing branch afterward. The
  // Background's landing branch is the ambient checkout every later step
  // assumes ("judge <sha> against HEAD as the landing branch") - direct
  // mode reads HEAD literally, and leaving HEAD on primary/art-director
  // itself after minting the tip would judge the tip against its own
  // commit (an empty diff) instead of against the landing branch.
  registry.defineScoped(/^the art director's tip changes only (\S+)$/, (ctx, tipPath) => {
    assert.ok(KNOWN_TIP_PATHS.has(tipPath), `unknown tip path example value: ${tipPath}`);
    git(ctx.root, 'checkout', '-q', 'primary/art-director');
    writeAndAdd(ctx.root, tipPath);
    git(ctx.root, 'commit', '-q', '-m', `art-director tip changing ${tipPath}`);
    ctx.adTip = git(ctx.root, 'rev-parse', 'HEAD');
    git(ctx.root, 'checkout', '-q', ctx.landingBranch);
  }, FEATURE);

  registry.defineScoped(/^the art director's tip changes docs\/design\/system\.md and (\S+)$/, (ctx, outPath) => {
    assert.ok(KNOWN_OUT_OF_LANE_PATHS.has(outPath), `unknown out-of-lane path example value: ${outPath}`);
    git(ctx.root, 'checkout', '-q', 'primary/art-director');
    writeAndAdd(ctx.root, 'docs/design/system.md');
    writeAndAdd(ctx.root, outPath);
    git(ctx.root, 'commit', '-q', '-m', `art-director tip changing docs/design/system.md and ${outPath}`);
    ctx.adTip = git(ctx.root, 'rev-parse', 'HEAD');
    git(ctx.root, 'checkout', '-q', ctx.landingBranch);
  }, FEATURE);

  registry.defineScoped(/^main gains a commit touching extension\/src\/ and primary\/art-director merges main$/, (ctx) => {
    ctx.earlyMain = git(ctx.root, 'rev-parse', 'main');
    git(ctx.root, 'checkout', '-q', 'main');
    writeAndAdd(ctx.root, 'extension/src/main_change.ts');
    git(ctx.root, 'commit', '-q', '-m', 'main gains extension/src change');
    ctx.newMain = git(ctx.root, 'rev-parse', 'main');
    git(ctx.root, 'checkout', '-q', 'primary/art-director');
    git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'art-director merges main', 'main');
    ctx.adMergedMain = git(ctx.root, 'rev-parse', 'primary/art-director');
  }, FEATURE);

  registry.defineScoped(/^a role worktree branch is checked out at the commit before that$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', '-b', 'role-branch', ctx.earlyMain);
    ctx.roleBranch = 'role-branch';
  }, FEATURE);

  registry.defineScoped(/^the landing branch is still at the earlier main tip$/, (ctx) => {
    const tip = git(ctx.root, 'rev-parse', ctx.landingBranch);
    assert.equal(tip, ctx.earlyMain, 'expected the landing branch to still be at the earlier main tip');
  }, FEATURE);

  registry.defineScoped(
    /^a commit on a branch other than primary\/art-director that changes only docs\/design\/system\.md$/,
    (ctx) => {
      git(ctx.root, 'checkout', '-q', '-b', 'not-art-director', 'main');
      writeAndAdd(ctx.root, 'docs/design/system.md');
      git(ctx.root, 'commit', '-q', '-m', 'on a branch other than primary/art-director');
      ctx.otherSha = git(ctx.root, 'rev-parse', 'HEAD');
      git(ctx.root, 'checkout', '-q', ctx.landingBranch);
    },
    FEATURE
  );

  // ── When ────────────────────────────────────────────────────────────────
  registry.defineScoped(/^the landing branch merges the tip with --no-ff$/, (ctx) => {
    mergeWithNoFf(ctx, ctx.landingBranch, ctx.adTip, 'merge art-director tip');
  }, FEATURE);

  registry.defineScoped(/^the role worktree merges main's tip with --no-ff$/, (ctx) => {
    mergeWithNoFf(ctx, ctx.roleBranch, 'main', 'merge main tip');
  }, FEATURE);

  registry.defineScoped(/^the guard is asked about the tip directly$/, (ctx) => {
    const result = spawnSync('bash', [GUARD_SCRIPT, '--tip', ctx.adTip], { cwd: ctx.root, encoding: 'utf8' });
    ctx.directResult = { rc: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
  }, FEATURE);

  registry.defineScoped(/^the guard is asked about that commit directly$/, (ctx) => {
    const result = spawnSync('bash', [GUARD_SCRIPT, '--tip', ctx.otherSha], { cwd: ctx.root, encoding: 'utf8' });
    ctx.directResult = { rc: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
  }, FEATURE);

  // ── Then ────────────────────────────────────────────────────────────────
  registry.defineScoped(/^the merge succeeds$/, (ctx) => {
    assert.equal(ctx.mergeResult.rc, 0, `expected the merge to succeed, got exit ${ctx.mergeResult.rc}: ${ctx.mergeResult.err}`);
  }, FEATURE);

  registry.defineScoped(/^the tip is an ancestor of the landing branch$/, (ctx) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', ctx.adTip, ctx.landingBranch], { cwd: ctx.root });
    assert.equal(result.status, 0, `expected ${ctx.adTip} to be an ancestor of ${ctx.landingBranch}`);
  }, FEATURE);

  registry.defineScoped(/^the merge is refused with a non-zero exit$/, (ctx) => {
    assert.notEqual(ctx.mergeResult.rc, 0, 'expected the merge to be refused, got exit 0');
  }, FEATURE);

  registry.defineScoped(
    /^the refusal names (\S+) and says an art director tip may carry only docs\/design\/ and its own evidence$/,
    (ctx, offendingPath) => {
      assert.ok(KNOWN_OUT_OF_LANE_PATHS.has(offendingPath), `unknown offending path example value: ${offendingPath}`);
      const combined = `${ctx.mergeResult.out}${ctx.mergeResult.err}`;
      assert.match(
        combined,
        new RegExp(escapeForRegExp(offendingPath)),
        `expected the refusal to name ${offendingPath}, got: ${combined}`
      );
      assert.match(
        combined,
        /art director tip may carry only docs\/design\/ and its own evidence/i,
        `expected the refusal to state the lane rule, got: ${combined}`
      );
    },
    FEATURE
  );

  registry.defineScoped(/^the landing branch's tip is unchanged$/, (ctx) => {
    const tip = git(ctx.root, 'rev-parse', ctx.landingBranch);
    assert.equal(tip, ctx.landingTipBefore, "expected the landing branch's tip to be unchanged");
  }, FEATURE);

  registry.defineScoped(/^it exits (\d+) and prints (\S+)$/, (ctx, exit, verdict) => {
    assert.ok(KNOWN_EXITS.has(exit), `unknown exit example value: ${exit}`);
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown verdict example value: ${verdict}`);
    assert.equal(ctx.directResult.rc, Number(exit), `expected exit ${exit}, got ${ctx.directResult.rc}: ${ctx.directResult.err}`);
    const combined = `${ctx.directResult.out}${ctx.directResult.err}`;
    assert.match(combined, new RegExp(escapeForRegExp(verdict)), `expected output to print ${verdict}, got: ${combined}`);
  }, FEATURE);

  registry.defineScoped(/^the refusal says the commit is not on primary\/art-director$/, (ctx) => {
    const combined = `${ctx.directResult.out}${ctx.directResult.err}`;
    assert.match(
      combined,
      /is not on primary\/art-director/i,
      `expected the refusal to say the commit is not on primary/art-director, got: ${combined}`
    );
  }, FEATURE);
}

module.exports = { registerSteps };
