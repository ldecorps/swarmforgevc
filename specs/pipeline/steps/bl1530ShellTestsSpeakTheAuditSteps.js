'use strict';

// BL-1530: step handlers for "BL-1530 The shell tests that drive
// swarm_handoff once speak the two-call audit". Scenario 01/02/04 drive the
// REAL shell test files as subprocesses (the fixture is the shell tests'
// own, this handler never re-implements their fixtures). Scenarios 02, 03
// and 04's first Then step grep the FILES for the two-call shape rather
// than re-running their internal logic, per the ticket's own direction.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1530 The shell tests that drive swarm_handoff once speak the two-call audit';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const THREE_FILES = [
  'test_rule_proposal.sh',
  'test_handoff_state_dir_worktree_root.sh',
  'test_required_stages_ticket_lookup_collision.sh',
];

// The env vars these three files legitimately read/set today (verified
// against the tree this ticket lands on) - anything else appearing in one
// of them is a candidate audit-bypass var swarm_handoff.bb has no business
// having grown, and the ticket's own FIRM constraint says none was added.
const ALLOWED_ENV_VARS = new Set([
  'SWARMFORGE_ROLE',
  'SWARMFORGE_SKIP_SYNC_INJECT',
  'SWARMFORGE_SKIP_DAEMON',
  'SWARMFORGE_MAILBOX_ONLY',
  'SWARMFORGE_REQUIRED_STAGES_ROUTING',
  'SWARMFORGE_ALLOW_TMP_DAEMON',
]);

function readTestFile(file) {
  return fs.readFileSync(path.join(SCRIPTS_TEST_DIR, file), 'utf8');
}

function runShellTest(file, opts = {}) {
  return spawnSync('bash', [path.join(SCRIPTS_TEST_DIR, file)], {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
  });
}

function assertAllPass(res, label) {
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, `${label} is still red:\n${out}`);
  assert.match(out, /ALL PASS/, `${label} did not report ALL PASS:\n${out}`);
  assert.doesNotMatch(out, /^FAIL:/m, `${label} reported a failure:\n${out}`);
}

function censusGitHandoffSendingShellTests() {
  return fs
    .readdirSync(SCRIPTS_TEST_DIR)
    .filter((name) => name.startsWith('test_') && name.endsWith('.sh'))
    .filter((name) => {
      const src = readTestFile(name);
      return /swarm_handoff\.(sh|bb)/.test(src) && /type: git_handoff/.test(src);
    })
    .sort();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── shell-tests-speak-the-audit-01 / shared "When ... runs" ─────────────

  scoped(/^swarmforge\/scripts\/test\/(\S+) runs$/, (ctx, file) => {
    assert.ok(THREE_FILES.includes(file), `unexpected file named by the scenario: ${file}`);
    ctx.bl1530File = file;
    ctx.bl1530Run = runShellTest(file);
  });

  scoped(/^it prints ALL PASS and exits zero$/, (ctx) => {
    assertAllPass(ctx.bl1530Run, ctx.bl1530File);
  });

  // ── shell-tests-speak-the-audit-02 ──────────────────────────────────────

  scoped(/^its git_handoff case asserts that the first call printed AUDIT_REQUIRED and queued nothing$/, () => {
    const src = readTestFile('test_rule_proposal.sh');
    assert.match(src, /AUDIT_REQUIRED/, 'test_rule_proposal.sh no longer checks for AUDIT_REQUIRED on the git_handoff row');
    assert.match(src, /HANDOFF_NOT_QUEUED/, 'test_rule_proposal.sh no longer checks for HANDOFF_NOT_QUEUED on the git_handoff row');
  });

  scoped(/^its git_handoff case asserts the mailbox-only queue grammar on the second identical call$/, () => {
    const src = readTestFile('test_rule_proposal.sh');
    const sends = src.match(/run_swarm_handoff "\$GIT_HANDOFF_DRAFT"/g) || [];
    assert.ok(
      sends.length >= 2,
      'expected the git_handoff draft to be sent through run_swarm_handoff at least twice (the audit challenge, then the real send)',
    );
    assert.match(
      src,
      /assert_queued "04 \[git_handoff\]"/,
      'expected the second git_handoff call to be checked against the mailbox-only queue grammar',
    );
  });

  // ── shell-tests-speak-the-audit-03 ──────────────────────────────────────

  scoped(/^swarmforge\/scripts\/swarm_handoff\.bb on the tree as it stands is compared with main$/, (ctx) => {
    ctx.bl1530Diff = spawnSync('git', ['diff', 'main', '--', 'swarmforge/scripts/swarm_handoff.bb'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  });

  scoped(/^it is unchanged$/, (ctx) => {
    assert.equal(ctx.bl1530Diff.status, 0, `git diff failed: ${ctx.bl1530Diff.stderr}`);
    assert.equal(
      ctx.bl1530Diff.stdout.trim(),
      '',
      `swarmforge/scripts/swarm_handoff.bb differs from main:\n${ctx.bl1530Diff.stdout}`,
    );
  });

  scoped(/^none of the three test files sets an environment variable that swarm_handoff\.bb reads to skip the audit$/, () => {
    for (const file of THREE_FILES) {
      const src = readTestFile(file);
      const used = new Set(src.match(/SWARMFORGE_[A-Z_]+/g) || []);
      for (const name of used) {
        assert.ok(ALLOWED_ENV_VARS.has(name), `${file} references unexpected env var ${name} - possible audit bypass`);
      }
    }
  });

  // ── shell-tests-speak-the-audit-04 ──────────────────────────────────────

  scoped(/^its control-character case waits on the daemon's delivery evidence with a deadline of at least ten seconds$/, () => {
    const src = readTestFile('test_rule_proposal.sh');
    const section03b = src.slice(src.indexOf('03b'));
    assert.match(section03b, /AUDIT_FILE/, "03b's drain wait no longer polls the audit file it reads next");
    const seqMatch = section03b.match(/seq 1 (\d+)/);
    const sleepMatch = section03b.match(/sleep (\d+(?:\.\d+)?)/);
    assert.ok(seqMatch && sleepMatch, "03b's bounded drain-wait loop was not found");
    const deadline = Number(seqMatch[1]) * Number(sleepMatch[1]);
    assert.ok(deadline >= 10, `03b's drain-wait deadline is ${deadline}s, expected at least 10s`);
  });

  scoped(/^it passes five consecutive runs$/, () => {
    for (let i = 0; i < 5; i += 1) {
      const res = runShellTest('test_rule_proposal.sh');
      assertAllPass(res, `test_rule_proposal.sh (run ${i + 1}/5)`);
    }
  });

  // ── shell-tests-speak-the-audit-05 ──────────────────────────────────────

  scoped(/^every shell test under swarmforge\/scripts\/test that invokes swarm_handoff and drafts a git_handoff is listed$/, (ctx) => {
    ctx.bl1530Census = censusGitHandoffSendingShellTests();
  });

  scoped(/^the list names test_rule_proposal\.sh$/, (ctx) => {
    assert.ok(
      ctx.bl1530Census.includes('test_rule_proposal.sh'),
      `census did not include test_rule_proposal.sh: ${ctx.bl1530Census.join(', ')}`,
    );
  });

  scoped(/^the list has eleven entries$/, (ctx) => {
    assert.equal(ctx.bl1530Census.length, 11, `expected 11 entries, got ${ctx.bl1530Census.length}: ${ctx.bl1530Census.join(', ')}`);
  });
}

module.exports = { registerSteps };
