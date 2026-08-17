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
const PRE_COMMIT_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-commit');
const PRE_MERGE_COMMIT_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-merge-commit');

function mkFixtureRepo() {
  const d = mkTmpDir('bl632-prop-fixture-');
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
    [PRE_COMMIT_HOOK, 'swarmforge/git-hooks/pre-commit'],
    [PRE_MERGE_COMMIT_HOOK, 'swarmforge/git-hooks/pre-merge-commit'],
  ]) {
    const dst = path.join(d, rel);
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
  }
  execFileSync('git', ['add', '-A'], { cwd: d });
  execFileSync('git', ['commit', '-q', '-m', 'seed hooks'], { cwd: d });
  execFileSync('git', ['config', 'core.hooksPath', 'swarmforge/git-hooks'], { cwd: d });
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

// Each generated case spins up a real fixture git repo (init, hook install,
// commit) plus 2-6 further real git subprocesses for the action itself -
// same real-subprocess-over-reimplementation tradeoff as
// bl628AutonomousHostBootstrapInvariants.property.test.js, which sets the
// same kind of explicit per-test timeout for the same reason. numRuns kept
// modest (10) to stay well inside it while still exercising every action x
// role-shape x path-depth combination the generators can reach.
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
