'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-632 declared invariant (backlog/active/BL-632-commit-time-guard-refuses-pipeline-code-on-main.yaml):
// "No commit path available to a non-QA role - commit, merge, or amend -
// can land pipeline code on `main`; the guard refuses at creation time."
// Coder-authored property test per BL-654; runs only via npm run
// test:properties. Drives the REAL swarmforge/scripts/check_pipeline_code_on_main.sh
// through REAL git hooks (installed via core.hooksPath, same as
// swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh's fixture
// pattern) as real subprocesses - never a parallel reimplementation of the
// guard's decision logic.

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_pipeline_code_on_main.sh');
const SIZE_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_commit_size.sh');
const TICKET_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_ticket_deletion.sh');
const PROPERTY_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');
const FEATURE_HANDLER_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_feature_handler_registration.sh');
// BL-1252 moved the pre-commit hook's guards behind this runner and BL-1303
// gave pre-merge-commit a chain of its own over the same sourced aggregation.
// Both files are part of what the hooks EXECUTE, so a fixture without them
// runs no guard at all - every action fails with "No such file or directory"
// instead of the refusal this property is about.
const GUARD_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'run_commit_guards.sh');
const GUARD_CHAIN_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'commit_guard_chain_lib.sh');
// Libs the guards SOURCE. A guard whose lib is absent dies at its source
// line before deciding anything, so the fixture carries them too.
const MERGE_PARENT_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'incoming_merge_parent_lib.sh');
const SHARED_REPO_GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_shared_repo_guard.sh');
const STANDING_ALLOWLIST_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist_lib.sh');
const PRE_COMMIT_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-commit');
const PRE_MERGE_COMMIT_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-merge-commit');

// BL-971: the measured per-case cost was NEVER the git subprocesses - it
// was macOS Gatekeeper assessing each freshly created executable on its
// FIRST exec (~1.2-1.8s per file, per inode, worse under load; measured
// 2026-08-20: first exec of a fresh guard-script copy 1.16-1.84s, second
// exec of the same inode 55ms). Hook/guard executables exec'd per case
// dominated runtime; the fixture repo is BUILT once (template below), its
// executables are WARMED once (one exec each seeds the per-inode assessment
// cache), and each generated case gets a recursive copy whose executables
// are re-HARDLINKED to the template's warmed inodes - the assessment cache
// keys on the inode, so every case's action pays git, the REAL hooks, and
// the REAL guards, never a fresh Gatekeeper scan. Nothing about the
// invariant weakens: the per-case action still runs real git against real
// hook files with identical content in the case's own repo.
const EXEC_FIXTURE_FILES = [
  'swarmforge/scripts/check_pipeline_code_on_main.sh',
  'swarmforge/scripts/check_commit_size.sh',
  'swarmforge/scripts/check_ticket_deletion.sh',
  'swarmforge/scripts/check_property_suite_drift.sh',
  'swarmforge/scripts/check_feature_handler_registration.sh',
  'swarmforge/scripts/run_commit_guards.sh',
  'swarmforge/scripts/commit_guard_chain_lib.sh',
  'swarmforge/scripts/incoming_merge_parent_lib.sh',
  'swarmforge/scripts/property_suite_shared_repo_guard.sh',
  'swarmforge/scripts/property_suite_standing_allowlist_lib.sh',
  'swarmforge/git-hooks/pre-commit',
  'swarmforge/git-hooks/pre-merge-commit',
];

let fixtureTemplate = null;

function mkFixtureTemplate() {
  const d = mkTmpDir('bl632-prop-template-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: d });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: d });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: d });

  fs.mkdirSync(path.join(d, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(d, 'swarmforge', 'git-hooks'), { recursive: true });
  for (const [src, rel] of [
    [GUARD_SCRIPT, 'swarmforge/scripts/check_pipeline_code_on_main.sh'],
    [SIZE_GUARD, 'swarmforge/scripts/check_commit_size.sh'],
    [TICKET_GUARD, 'swarmforge/scripts/check_ticket_deletion.sh'],
    [PROPERTY_GUARD, 'swarmforge/scripts/check_property_suite_drift.sh'],
    [FEATURE_HANDLER_GUARD, 'swarmforge/scripts/check_feature_handler_registration.sh'],
    [GUARD_RUNNER, 'swarmforge/scripts/run_commit_guards.sh'],
    [GUARD_CHAIN_LIB, 'swarmforge/scripts/commit_guard_chain_lib.sh'],
    [MERGE_PARENT_LIB, 'swarmforge/scripts/incoming_merge_parent_lib.sh'],
    [SHARED_REPO_GUARD_LIB, 'swarmforge/scripts/property_suite_shared_repo_guard.sh'],
    [STANDING_ALLOWLIST_LIB, 'swarmforge/scripts/property_suite_standing_allowlist_lib.sh'],
    [PRE_COMMIT_HOOK, 'swarmforge/git-hooks/pre-commit'],
    [PRE_MERGE_COMMIT_HOOK, 'swarmforge/git-hooks/pre-merge-commit'],
  ]) {
    const dst = path.join(d, rel);
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
  }
  // check_feature_handler_registration.sh resolves its compiled checker
  // relative to its OWN script dir, so the fixture's copy needs the real
  // out tree beside it. A symlink, not a copy: the fixture is rebuilt per
  // case and the tree is large.
  // An EMPTY step registry, so the feature-handler guard (BL-1303) asks its
  // real question of the fixture - no feature file is unrunnable here - and
  // does not refuse merely because a tree with no acceptance pipeline has no
  // registry to read.
  fs.mkdirSync(path.join(d, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.writeFileSync(path.join(d, 'specs', 'pipeline', 'steps', 'index.js'), 'module.exports = [];\n');

  fs.mkdirSync(path.join(d, 'extension'), { recursive: true });
  try {
    fs.symlinkSync(path.join(REPO_ROOT, 'extension', 'out'), path.join(d, 'extension', 'out'), 'dir');
  } catch {
    // A checker the guard cannot resolve is a refusal naming the reason
    // (BL-1303 fails closed), which still refuses the action this property
    // asserts is refused - slower to read, never a false pass.
  }
  execFileSync('git', ['add', '-A'], { cwd: d });
  execFileSync('git', ['commit', '-q', '-m', 'seed hooks'], { cwd: d });
  execFileSync('git', ['config', 'core.hooksPath', 'swarmforge/git-hooks'], { cwd: d });

  // Warm each executable's per-inode assessment cache with one direct
  // exec. Exit codes are irrelevant here (pre-merge-commit has no merge
  // context to succeed in) - only the exec itself matters.
  for (const rel of EXEC_FIXTURE_FILES) {
    spawnSync(path.join(d, rel), rel.endsWith('check_commit_size.sh') ? ['50'] : [], { cwd: d, encoding: 'utf8' });
  }
  return d;
}

function mkFixtureRepo() {
  if (!fixtureTemplate) {
    fixtureTemplate = mkFixtureTemplate();
  }
  const d = mkTmpDir('bl632-prop-fixture-');
  // The template embeds no absolute paths (relative core.hooksPath, local
  // user config), so a byte copy is a fully working repo.
  fs.cpSync(fixtureTemplate, d, { recursive: true });
  // Re-hardlink the executables to the template's WARMED inodes (same
  // tmpdir volume). Fall back to the plain copy if linking ever fails -
  // slower, never wrong.
  for (const rel of EXEC_FIXTURE_FILES) {
    const target = path.join(d, rel);
    try {
      fs.rmSync(target);
      fs.linkSync(path.join(fixtureTemplate, rel), target);
    } catch {
      fs.copyFileSync(path.join(fixtureTemplate, rel), target);
      fs.chmodSync(target, 0o755);
    }
  }
  return d;
}

function commitEnv(role) {
  const env = { ...process.env };
  delete env.SWARMFORGE_ROLE;
  if (role !== undefined) {
    env.SWARMFORGE_ROLE = role;
  }
  return env;
}

function git(args, cwd, env) {
  return spawnSync('git', args, { cwd, env, encoding: 'utf8' });
}

// Generator reach: every non-QA shape a role can take - unset, every real
// pipeline role name, and an arbitrary other string - so the property
// covers more than the one or two roles a hand-picked example would use.
// "QA" itself is excluded: it is the one path this invariant does NOT cover.
const nonQaRoleArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom('coder', 'cleaner', 'architect', 'hardener', 'documenter', 'coordinator', 'specifier'),
  fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,10}$/)
    .filter((s) => s !== 'QA')
);

const qaExclusivePrefixArb = fc.constantFrom('extension/src/', 'extension/test/', 'specs/pipeline/steps/');
const pathSegmentArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/);

// Generator reach: varying nesting depth (0-3 subdirectories) under each of
// the three QA-exclusive roots, not one canonical file per root.
const pipelinePathArb = fc
  .tuple(qaExclusivePrefixArb, fc.array(pathSegmentArb, { minLength: 0, maxLength: 3 }), pathSegmentArb, fc.constantFrom('ts', 'js'))
  .map(([prefix, dirs, name, ext]) => {
    const relDirs = dirs.length ? `${dirs.join('/')}/` : '';
    return `${prefix}${relDirs}${name}.${ext}`;
  });

const actionArb = fc.constantFrom('commit', 'merge', 'amend');

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Each generated case copies the prebuilt fixture repo (one fs call - see
// mkFixtureRepo above, BL-971) and then runs 2-6 REAL git subprocesses for
// the action itself through the REAL hooks - the same
// real-subprocess-over-reimplementation tradeoff as
// bl628AutonomousHostBootstrapInvariants.property.test.js. numRuns 10
// unchanged, so the action x role-shape x path-depth generator coverage is
// exactly what it was. Budget basis (measured 2026-08-20, swarm host,
// live load): pre-BL-971 the file ran 71s moderately loaded and 154s
// under QA's full 8-agent load (the BL-971 failure) - almost all of it
// per-case Gatekeeper assessment of fresh executable copies (see
// mkFixtureRepo). With warmed-inode fixtures the whole test measured
// 16-23s over two consecutive live-load runs (~1.6-2.3s per case: the
// action's own real git+hook subprocesses under load). 90s budget =
// ~4-5x headroom over the measured loaded cost, kept rather than
// tightened so a loaded host degrades toward slow-pass, never toward a
// false red.
test('property (invariant): no non-QA commit, merge, or amend path lands pipeline code on main', () => {
  fc.assert(
    fc.property(actionArb, nonQaRoleArb, pipelinePathArb, (action, role, relPath) => {
      const d = mkFixtureRepo();
      const fullPath = path.join(d, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });

      let res;
      if (action === 'commit') {
        fs.writeFileSync(fullPath, 'v1\n');
        execFileSync('git', ['add', relPath], { cwd: d });
        res = git(['commit', '-q', '-m', 'change'], d, commitEnv(role));
      } else if (action === 'merge') {
        execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: d });
        fs.writeFileSync(fullPath, 'v1\n');
        execFileSync('git', ['add', relPath], { cwd: d });
        execFileSync('git', ['commit', '-q', '-m', 'feature change'], { cwd: d, env: commitEnv('QA') });
        execFileSync('git', ['checkout', '-q', 'main'], { cwd: d });
        res = git(['merge', '--no-ff', '-q', '-m', 'merge feature', 'feature'], d, commitEnv(role));
      } else {
        // amend: the commit being amended must already exist on main - it
        // could only have landed there via QA, so seed it as QA, then
        // attempt the amend itself as a non-QA role.
        fs.writeFileSync(fullPath, 'v1\n');
        execFileSync('git', ['add', relPath], { cwd: d });
        execFileSync('git', ['commit', '-q', '-m', 'initial (QA)'], { cwd: d, env: commitEnv('QA') });
        fs.writeFileSync(fullPath, 'v2\n');
        execFileSync('git', ['add', relPath], { cwd: d });
        res = git(['commit', '-q', '--amend', '-m', 'amended'], d, commitEnv(role));
      }

      const combinedOutput = `${res.stdout || ''}${res.stderr || ''}`;
      assert.notStrictEqual(
        res.status,
        0,
        `expected action=${action} role=${JSON.stringify(role)} path=${relPath} to be REFUSED, ` +
          `got exit ${res.status}: ${combinedOutput}`
      );
      assert.match(
        combinedOutput,
        new RegExp(escapeForRegExp(relPath)),
        `refusal message must name the offending path ${relPath}, got: ${combinedOutput}`
      );

      if (action === 'merge') {
        // leave the repo clean for anything that inspects it afterward
        git(['merge', '--abort'], d, commitEnv(undefined));
      }
    }),
    { numRuns: 10 }
  );
}, 90000);
