'use strict';

// BL-1295: step handlers for "a revert commit does not blame the ticket
// whose subject it inherited".
//
// Every scenario builds a REAL git repository and drives the REAL
// task_scope_gate_lib.bb through its own public seams - the walk
// (task-tagged-changed-paths), the foreign-path decision
// (foreign-scope-findings) and the verdict (blocked?). Nothing here
// re-implements the predicate under test.
//
// Only the walk BASE is supplied directly rather than resolved from a
// handoff archive. That lookup is not what this ticket changes, and
// building an archive would put a second, unrelated mechanism between the
// scenario and the behaviour it is asserting.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'task_scope_gate_lib.bb');

const FEATURE = 'A revert commit does not blame the ticket whose subject it inherited';

// The live shapes from the 2026-08-30 BL-1240 block, not invented ones.
const TASK = 'BL-1240';
const OWN_PATH = 'extension/src/metrics/bl1240Fixture.ts';
const FOREIGN_PATH = 'docs/how-to/BL-973-bb-fixture-closure-guards-and-suite-inventory.md';
const MERGE_SUBJECT = `Merge documenter ${TASK} 0ca3bc03c0 into QA. By QA.`;

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
}

function commitFile(root, filePath, subject) {
  const full = path.join(root, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, `${subject}\n`);
  git(root, 'add', filePath);
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', subject);
  return git(root, 'rev-parse', 'HEAD').trim();
}

function bb(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}`);
  return result.stdout.trim();
}

function initRepo(ctx) {
  ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1295-aps-'));
  git(ctx.root, 'init', '-q', '-b', 'main');
  git(ctx.root, 'config', 'user.email', 'test@test');
  git(ctx.root, 'config', 'user.name', 'test');
  git(ctx.root, 'config', 'commit.gpgsign', 'false');
  commitFile(ctx.root, 'seed.txt', 'seed');
  ctx.base = git(ctx.root, 'rev-parse', 'HEAD').trim();
}

// The task's own work merged in, carrying a foreign path alongside it -
// which is what makes REVERTING that merge name the foreign path.
function mergeTaskWork(ctx) {
  git(ctx.root, 'checkout', '-q', '-b', 'work');
  commitFile(ctx.root, OWN_PATH, `${TASK}: the parcel's own work`);
  commitFile(ctx.root, FOREIGN_PATH, 'BL-0973: another ticket carried in the same merge');
  git(ctx.root, 'checkout', '-q', 'main');
  git(ctx.root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '-m', MERGE_SUBJECT, 'work');
  return git(ctx.root, 'rev-parse', 'HEAD').trim();
}

function revertMerge(ctx, mergeSha) {
  git(ctx.root, '-c', 'core.hooksPath=/dev/null', 'revert', '--no-edit', '-m', '1', mergeSha);
  return git(ctx.root, 'rev-parse', 'HEAD').trim();
}

function tip(ctx) {
  return git(ctx.root, 'rev-parse', 'HEAD').trim();
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a scope gate walking a parcel's commits since its last handoff$/, (ctx) => {
    initRepo(ctx);
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(
    /^a revert commit whose subject is Revert quoting an earlier subject that names the task$/,
    (ctx) => {
      const own = commitFile(ctx.root, OWN_PATH, `${TASK}: the parcel's own work`);
      ctx.revertSha = revertMerge(ctx, own);
      ctx.ownSha = own;
      // The premise the whole ticket rests on: the revert's subject really
      // does carry the task's id. If git ever stopped writing it that way,
      // this scenario would be testing nothing.
      const subject = git(ctx.root, 'log', '-1', '--format=%s', ctx.revertSha).trim();
      assert.ok(subject.startsWith('Revert "'), `git did not write a quoting revert subject: ${subject}`);
      assert.ok(subject.includes(TASK), `the revert subject does not inherit the task id: ${subject}`);
    }
  );

  scoped(/^the gate decides which commits belong to the task$/, (ctx) => {
    ctx.belongs = {};
    for (const [label, sha] of [['own', ctx.ownSha], ['revert', ctx.revertSha]]) {
      const subject = git(ctx.root, 'log', '-1', '--format=%s', sha).trim();
      ctx.belongs[label] =
        bb(
          `(load-file ${JSON.stringify(GATE_LIB)}) (print (boolean (task-scope-gate-lib/subject-names-task? ${JSON.stringify(subject)} ${JSON.stringify(TASK)})))`
        ) === 'true';
    }
  });

  scoped(/^the revert commit is not among them$/, (ctx) => {
    assert.equal(ctx.belongs.revert, false, 'the revert was attributed to the ticket it merely quoted');
    // Stated as a pair on purpose: exempting everything would satisfy the
    // first half alone and break the gate.
    assert.equal(ctx.belongs.own, true, 'the ticket lost its own commit');
    cleanup(ctx);
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(
    /^a commit whose own subject names the task and whose diff touches a path belonging to another ticket$/,
    (ctx) => {
      commitFile(ctx.root, OWN_PATH, `${TASK}: the parcel's own work`);
      commitFile(ctx.root, FOREIGN_PATH, `${TASK}: genuinely reaching into another ticket's file`);
    }
  );

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(/^the walk contains a revert of an earlier merge of the task$/, (ctx) => {
    ctx.mergeSha = mergeTaskWork(ctx);
    // BL-1297: the walk starts just after that merge, so the merge itself is
    // not a candidate. It carries a foreign path deliberately - that is what
    // makes REVERTING it name that path - and since BL-1297 a merge's own
    // first-parent change is no longer invisible to the walk, so leaving the
    // merge in range would refuse this scenario on the merge's own account
    // and stop it testing the revert at all. The revert stays in range, which
    // is the only commit this scenario is about.
    ctx.base = ctx.mergeSha;
    ctx.revertSha = revertMerge(ctx, ctx.mergeSha);
  });

  scoped(/^the only foreign path in the walk appears solely in that revert$/, (ctx) => {
    // Asserted, not assumed - if the fixture leaked the foreign path into a
    // non-revert commit the scenario would pass for the wrong reason.
    const revertPaths = git(ctx.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', ctx.revertSha)
      .split('\n')
      .filter(Boolean);
    assert.ok(revertPaths.includes(FOREIGN_PATH), `the revert does not name the foreign path: ${revertPaths}`);
    const nonRevert = git(ctx.root, 'rev-list', '--first-parent', `${ctx.base}..HEAD`)
      .split('\n')
      .filter(Boolean)
      .filter((sha) => sha !== ctx.revertSha);
    for (const sha of nonRevert) {
      const paths = git(ctx.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--first-parent', sha)
        .split('\n')
        .filter(Boolean);
      assert.ok(
        !paths.includes(FOREIGN_PATH),
        `the foreign path also appears outside the revert, in ${sha} - the fixture does not test what it claims`
      );
    }
  });

  // ── Scenarios 02 / 03 shared ──────────────────────────────────────────────
  scoped(/^the gate decides whether the handoff may be sent$/, (ctx) => {
    const out = bb(`
(load-file ${JSON.stringify(GATE_LIB)})
(let [paths (task-scope-gate-lib/task-tagged-changed-paths ${JSON.stringify(ctx.root)} ${JSON.stringify(ctx.base)} ${JSON.stringify(tip(ctx))} ${JSON.stringify(TASK)})
      findings (task-scope-gate-lib/foreign-scope-findings ${JSON.stringify(TASK)} paths)]
  (print (pr-str {:blocked (task-scope-gate-lib/blocked? {:findings findings})
                  :message (task-scope-gate-lib/refusal-message {:findings findings})})))`);
    ctx.verdict = out;
    ctx.blocked = out.includes(':blocked true');
  });

  scoped(/^the handoff is refused$/, (ctx) => {
    assert.equal(ctx.blocked, true, `the handoff was allowed: ${ctx.verdict}`);
  });

  scoped(/^the refusal names the foreign path$/, (ctx) => {
    assert.ok(ctx.verdict.includes(FOREIGN_PATH), `the refusal did not name the foreign path: ${ctx.verdict}`);
    cleanup(ctx);
  });

  scoped(/^the handoff is allowed$/, (ctx) => {
    assert.equal(ctx.blocked, false, `the handoff was refused: ${ctx.verdict}`);
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
