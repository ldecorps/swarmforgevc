'use strict';

// BL-1568: step handlers for "BL-1568 The dispatch-gap autoroute test
// asserts the gap by id and assignee" (specifier-authored feature, not
// touched by this parcel). Scenarios drive the REAL shell test/runners as
// subprocesses or grep the FILE for the pinned assertion shape - this
// handler never re-implements the shell test's fixture.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1568 The dispatch-gap autoroute test asserts the gap by id and assignee';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const TEST_FILE = 'test_dispatch_gap_autoroute.sh';

function readTestFile() {
  return fs.readFileSync(path.join(SCRIPTS_TEST_DIR, TEST_FILE), 'utf8');
}

function runShellTest() {
  return spawnSync('bash', [path.join(SCRIPTS_TEST_DIR, TEST_FILE)], {
    encoding: 'utf8',
    timeout: 120000,
  });
}

function assertAllPass(res) {
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, `${TEST_FILE} is still red:\n${out}`);
  assert.match(out, /ALL PASS/, `${TEST_FILE} did not report ALL PASS:\n${out}`);
  assert.doesNotMatch(out, /^FAIL:/m, `${TEST_FILE} reported a failure:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── dispatch-gap-by-id-and-assignee-01 ──────────────────────────────────

  scoped(/^swarmforge\/scripts\/test\/test_dispatch_gap_autoroute\.sh runs$/, (ctx) => {
    ctx.bl1568Run = runShellTest();
  });

  scoped(/^it prints ALL PASS and exits zero$/, (ctx) => {
    assertAllPass(ctx.bl1568Run);
  });

  // ── dispatch-gap-by-id-and-assignee-02 ──────────────────────────────────

  scoped(/^swarmforge\/scripts\/chase_sweep_lib\.bb on the tree as it stands is compared with main$/, (ctx) => {
    ctx.bl1568Diff = spawnSync('git', ['diff', 'main', '--', 'swarmforge/scripts/chase_sweep_lib.bb'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  });

  scoped(/^it is unchanged$/, (ctx) => {
    assert.equal(ctx.bl1568Diff.status, 0, `git diff failed: ${ctx.bl1568Diff.stderr}`);
    assert.equal(
      ctx.bl1568Diff.stdout.trim(),
      '',
      `swarmforge/scripts/chase_sweep_lib.bb differs from main:\n${ctx.bl1568Diff.stdout}`,
    );
  });

  // ── dispatch-gap-by-id-and-assignee-03 ──────────────────────────────────

  scoped(/^the file swarmforge\/scripts\/test\/test_dispatch_gap_autoroute\.sh is read$/, (ctx) => {
    ctx.bl1568Source = readTestFile();
  });

  scoped(/^its gap case asserts exactly one gap$/, (ctx) => {
    assert.match(
      ctx.bl1568Source,
      /\(assert \(= 1 \(count gaps\)\)/,
      `${TEST_FILE}'s gap case no longer asserts exactly one gap`,
    );
  });

  scoped(/^its gap case asserts the gap id BL-217 and the assignee coder$/, (ctx) => {
    assert.match(
      ctx.bl1568Source,
      /\(assert \(= \\"BL-217\\" \(:id \(first gaps\)\)\)/,
      `${TEST_FILE}'s gap case no longer pins the gap id BL-217`,
    );
    assert.match(
      ctx.bl1568Source,
      /\(assert \(= \\"coder\\" \(:assigned-to \(first gaps\)\)\)/,
      `${TEST_FILE}'s gap case no longer pins the assignee coder`,
    );
  });

  // ── dispatch-gap-by-id-and-assignee-04 (Scenario Outline) ───────────────

  scoped(/^swarmforge\/scripts\/test\/(.+) runs$/, (ctx, runner) => {
    ctx.bl1568RunnerName = runner;
    ctx.bl1568RunnerResult = spawnSync('bb', [path.join(SCRIPTS_TEST_DIR, runner)], {
      encoding: 'utf8',
      timeout: 120000,
    });
  });

  scoped(/^it exits zero$/, (ctx) => {
    const res = ctx.bl1568RunnerResult;
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    assert.equal(res.status, 0, `${ctx.bl1568RunnerName} is red:\n${out}`);
  });

  // ── dispatch-gap-by-id-and-assignee-05 (amendment 2026-09-15) ───────────
  // Reuses the "is read" step from scenario 03, which sets ctx.bl1568Source.

  scoped(
    /^its send case supplies the fixture HEAD commit to dispatch-gap-draft-lines and queues through the two-call audit$/,
    (ctx) => {
      assert.match(
        ctx.bl1568Source,
        /HEAD10="\$\(git -C "\$ROOT" rev-parse --short=10 HEAD\)"/,
        `${TEST_FILE} no longer captures the fixture's 10-hex HEAD`,
      );
      assert.match(
        ctx.bl1568Source,
        /\(chase-sweep-lib\/dispatch-gap-draft-lines \{:id \\"BL-217\\" :assigned-to \\"coder\\"\} \\"\$HEAD10\\"\)/,
        `${TEST_FILE}'s send case no longer supplies the commit to dispatch-gap-draft-lines (the legacy soft-note fallback is not a trail, BL-1223)`,
      );
      assert.match(
        ctx.bl1568Source,
        /handoff-lib\/queue-git-handoff!/,
        `${TEST_FILE}'s send case no longer queues through handoff-lib/queue-git-handoff!'s two-call audit (BL-1529)`,
      );
    },
  );

  scoped(/^its attribution case asserts type git_handoff and task BL-217$/, (ctx) => {
    assert.match(
      ctx.bl1568Source,
      /grep -q "\^type: git_handoff\$"/,
      `${TEST_FILE}'s attribution case no longer asserts type: git_handoff`,
    );
    assert.match(
      ctx.bl1568Source,
      /grep -q "\^task: BL-217\$"/,
      `${TEST_FILE}'s attribution case no longer asserts task: BL-217`,
    );
  });
}

module.exports = { registerSteps };
