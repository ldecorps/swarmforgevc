'use strict';

// BL-1252: step handlers for "the pre-commit guard chain reports every
// violation in one refusal".
//
// Each scenario makes a REAL `git commit` in a throwaway repo whose
// core.hooksPath is the REAL swarmforge/git-hooks directory, so the
// hook -> run_commit_guards.sh -> guards -> git-refuses path is exercised
// end to end. The only thing stubbed is the four guard scripts themselves,
// via run_commit_guards.sh's SWARMFORGE_COMMIT_GUARD_DIR seam: what each
// guard DECIDES is explicitly out of this ticket's scope (its own
// constraints say so, and invariant 2 forbids touching any predicate), and
// each guard's predicate is pinned by that guard's own tests. What is under
// test here is the chaining - that every index-inspection guard runs, that
// one refusal names all of them, and that the expensive suite is not paid
// for an already-refused commit.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOOKS_DIR = path.join(REPO_ROOT, 'swarmforge', 'git-hooks');

const FEATURE = 'The pre-commit guard chain reports every violation in one refusal';

// engineering.prompt's Scenario Outline rule: every Examples: value resolves
// through an explicit lookup, never a bare passthrough. Each token maps to
// the guard script the refusal must name.
const KNOWN_GUARDS = {
  'commit-size': 'check_commit_size.sh',
  'ticket-deletion': 'check_ticket_deletion.sh',
  'pipeline-code-on-main': 'check_pipeline_code_on_main.sh',
};
const SUITE_GUARD = 'check_property_suite_drift.sh';
const ALL_GUARDS = [...Object.values(KNOWN_GUARDS), SUITE_GUARD];

// "commit-size, ticket-deletion and pipeline-code-on-main" -> three tokens.
function parseViolations(phrase) {
  if (phrase === 'nothing') {
    return [];
  }
  return phrase
    .split(/,| and /)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_GUARDS, token)) {
        throw new Error(`unknown <violations> token: ${token}`);
      }
      return KNOWN_GUARDS[token];
    });
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function writeGuard(ctx, name, exitCode) {
  const marker = path.join(ctx.ran, name);
  fs.writeFileSync(
    path.join(ctx.guards, name),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `touch ${JSON.stringify(marker)}`,
      `exit ${exitCode}`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
}

// exits: guard-script name -> exit code. 1 is a guard's own refusal, any
// other non-zero is an unexpected failure.
function stageFixture(ctx, exits) {
  for (const guard of ALL_GUARDS) {
    writeGuard(ctx, guard, exits[guard] ?? 0);
  }
  fs.writeFileSync(path.join(ctx.repo, 'work.txt'), `change ${Date.now()}\n`);
  git(ctx.repo, 'add', 'work.txt');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^the shared git hooks are installed via core\.hooksPath$/, (ctx) => {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1252-aps-'));
    ctx.repo = path.join(ctx.root, 'repo');
    ctx.guards = path.join(ctx.root, 'guards');
    ctx.ran = path.join(ctx.root, 'ran');
    fs.mkdirSync(ctx.repo, { recursive: true });
    fs.mkdirSync(ctx.guards, { recursive: true });
    fs.mkdirSync(ctx.ran, { recursive: true });

    git(ctx.repo, 'init', '-q', '-b', 'main');
    git(ctx.repo, 'config', 'user.email', 'test@test');
    git(ctx.repo, 'config', 'user.name', 'test');
    git(ctx.repo, 'config', 'commit.gpgsign', 'false');
    git(ctx.repo, 'config', 'core.hooksPath', HOOKS_DIR);
    // The hook resolves REPO_ROOT to the fixture repo and invokes
    // swarmforge/scripts/run_commit_guards.sh BENEATH it, so the runner
    // must really be there - the same relative path production uses. Only
    // the guard scripts it calls are redirected, via the seam.
    fs.mkdirSync(path.join(ctx.repo, 'swarmforge', 'scripts'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'swarmforge', 'scripts', 'run_commit_guards.sh'),
      path.join(ctx.repo, 'swarmforge', 'scripts', 'run_commit_guards.sh')
    );
    fs.chmodSync(path.join(ctx.repo, 'swarmforge', 'scripts', 'run_commit_guards.sh'), 0o755);
    // The SAME hooks directory also carries the commit-msg hook, which is
    // explicitly out of this ticket's scope. Its three guards are no-ops in
    // the fixture so an unrelated gate cannot decide this feature's
    // outcome. They are never reached by the pre-commit chain, which reads
    // its guards from the seam directory instead.
    for (const guard of ['check_ticket_deletion.sh', 'check_merge_deletion.sh', 'check_retirement_readdition.sh']) {
      fs.writeFileSync(
        path.join(ctx.repo, 'swarmforge', 'scripts', guard),
        '#!/usr/bin/env bash\nexit 0\n',
        { mode: 0o755 }
      );
    }
    fs.writeFileSync(path.join(ctx.repo, 'seed.txt'), 'seed\n');
    git(ctx.repo, '-c', 'core.hooksPath=/dev/null', 'add', 'seed.txt');
    execFileSync('git', ['commit', '-q', '-m', 'seed', '--no-verify'], { cwd: ctx.repo });
  });

  // ── Scenarios 01 / 02 / 03 ────────────────────────────────────────────────
  scoped(/^a staged commit that violates (.+)$/, (ctx, phrase) => {
    ctx.violations = parseViolations(phrase);
    const exits = {};
    for (const guard of ctx.violations) {
      exits[guard] = 1;
    }
    stageFixture(ctx, exits);
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────────
  scoped(/^the ticket-deletion guard exits with an unexpected error rather than a refusal$/, (ctx) => {
    ctx.violations = [KNOWN_GUARDS['ticket-deletion']];
    ctx.unexpectedGuard = KNOWN_GUARDS['ticket-deletion'];
    stageFixture(ctx, { [KNOWN_GUARDS['ticket-deletion']]: 2 });
  });

  scoped(/^the commit is attempted$/, (ctx) => {
    const result = spawnSync('git', ['commit', '-m', 'BL-1252 fixture commit'], {
      cwd: ctx.repo,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_COMMIT_GUARD_DIR: ctx.guards },
    });
    ctx.status = result.status;
    ctx.output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  });

  scoped(/^the commit is refused$/, (ctx) => {
    assert.notEqual(ctx.status, 0, `the commit was allowed: ${ctx.output}`);
    assert.equal(
      git(ctx.repo, 'rev-list', '--count', 'HEAD').trim(),
      '1',
      'a refused commit still landed'
    );
  });

  scoped(/^the commit is allowed$/, (ctx) => {
    assert.equal(ctx.status, 0, `the commit was refused: ${ctx.output}`);
    assert.equal(
      git(ctx.repo, 'rev-list', '--count', 'HEAD').trim(),
      '2',
      'an allowed commit did not land'
    );
    // Deferring the expensive guard must never mean skipping it.
    assert.ok(
      fs.existsSync(path.join(ctx.ran, SUITE_GUARD)),
      'the property-suite guard was silently skipped on a passing commit'
    );
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  scoped(/^the refusal names every guard in (.+) and no other guard$/, (ctx, phrase) => {
    const expected = parseViolations(phrase);
    assert.deepEqual(expected, ctx.violations, 'the Then names a different violation set than the Given');
    for (const guard of Object.values(KNOWN_GUARDS)) {
      const shouldName = expected.includes(guard);
      assert.equal(
        ctx.output.includes(guard),
        shouldName,
        `${guard} should ${shouldName ? '' : 'NOT '}appear in the refusal: ${ctx.output}`
      );
      // Every index guard RAN, whatever the ones before it decided - a
      // violation that is merely named but never reached would be the same
      // defect wearing a better message.
      assert.ok(
        fs.existsSync(path.join(ctx.ran, guard)),
        `${guard} never ran - the chain still aborts at the first refusal`
      );
    }
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  scoped(/^the property suite is not run$/, (ctx) => {
    assert.ok(
      !fs.existsSync(path.join(ctx.ran, SUITE_GUARD)),
      'an already-refused commit paid for the property suite'
    );
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  scoped(/^the refusal names the guard that failed unexpectedly$/, (ctx) => {
    assert.ok(
      ctx.output.includes(ctx.unexpectedGuard),
      `the refusal did not name ${ctx.unexpectedGuard}: ${ctx.output}`
    );
    assert.match(
      ctx.output,
      /unexpected/i,
      `the refusal did not distinguish an error from a refusal: ${ctx.output}`
    );
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
