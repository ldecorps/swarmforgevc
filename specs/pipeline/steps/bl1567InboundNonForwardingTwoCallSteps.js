'use strict';

// BL-1567: step handlers for "BL-1567 The inbound non-forwarding test
// speaks the two-call audit" (specifier-authored feature, not touched by
// this parcel). Scenarios drive the REAL shell test file as a subprocess or
// grep the FILE for the two-call shape, per BL-1530's own direction
// (bl1530ShellTestsSpeakTheAuditSteps.js's shape) - this handler never
// re-implements the shell test's fixture.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1567 The inbound non-forwarding test speaks the two-call audit';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const TEST_FILE = 'test_swarm_handoff_inbound_non_forwarding.sh';

// The env vars this file legitimately reads/sets today (BL-1530's
// allow-list, same set - verified against the tree this ticket lands on).
// Anything else appearing in it is a candidate audit-bypass var
// swarm_handoff.bb has no business having grown; the ticket's own FIRM
// constraint says none was added.
const ALLOWED_ENV_VARS = new Set([
  'SWARMFORGE_ROLE',
  'SWARMFORGE_SKIP_SYNC_INJECT',
  'SWARMFORGE_SKIP_DAEMON',
  'SWARMFORGE_MAILBOX_ONLY',
  'SWARMFORGE_REQUIRED_STAGES_ROUTING',
  'SWARMFORGE_ALLOW_TMP_DAEMON',
]);

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

// Isolates the queueing (allowed-send) case's own helper function body, so
// scenario 03's env-var assertions cannot be satisfied by the two refusal
// cases' unrelated SWARMFORGE_SKIP_DAEMON=1 elsewhere in the file.
function queueingSendBody(src) {
  const start = src.indexOf('run_send_queue() {');
  assert.ok(start >= 0, `${TEST_FILE} no longer defines a run_send_queue helper for the queueing case`);
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, `${TEST_FILE}: could not find the end of run_send_queue`);
  return src.slice(start, end);
}

function censusGitHandoffSendingShellTests() {
  return fs
    .readdirSync(SCRIPTS_TEST_DIR)
    .filter((name) => name.startsWith('test_') && name.endsWith('.sh'))
    .filter((name) => {
      const src = fs.readFileSync(path.join(SCRIPTS_TEST_DIR, name), 'utf8');
      return /swarm_handoff\.(sh|bb)/.test(src) && /type: git_handoff/.test(src);
    })
    .sort();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── inbound-non-forwarding-two-call-01 / shared "When ... runs" ─────────

  scoped(/^swarmforge\/scripts\/test\/test_swarm_handoff_inbound_non_forwarding\.sh runs$/, (ctx) => {
    ctx.bl1567Run = runShellTest();
  });

  scoped(/^it prints ALL PASS and exits zero$/, (ctx) => {
    assertAllPass(ctx.bl1567Run);
  });

  // ── inbound-non-forwarding-two-call-02 ──────────────────────────────────

  scoped(/^its allowed-send case asserts that the first call printed AUDIT_REQUIRED and queued nothing$/, () => {
    const src = readTestFile();
    assert.match(src, /AUDIT_REQUIRED/, `${TEST_FILE} no longer checks for AUDIT_REQUIRED on the allowed-send case`);
    assert.match(
      src,
      /the audit challenge call queued a handoff/,
      `${TEST_FILE} no longer asserts nothing queued on the first call`,
    );
  });

  scoped(/^its allowed-send case asserts the mailbox-only queue grammar on the second identical call$/, () => {
    const src = readTestFile();
    const queueingCalls = src.match(/run_send_queue 2>&1/g) || [];
    assert.equal(
      queueingCalls.length,
      2,
      `expected the queueing helper to be invoked exactly twice (the audit challenge, then the real send), found ${queueingCalls.length}`,
    );
    assert.match(
      src,
      /HANDOFF QUEUED \(mailbox only, no tmux inject\):/,
      `${TEST_FILE} no longer checks the second call against the mailbox-only queue grammar`,
    );
  });

  // ── inbound-non-forwarding-two-call-03 ──────────────────────────────────

  scoped(/^the file swarmforge\/scripts\/test\/test_swarm_handoff_inbound_non_forwarding\.sh is read$/, (ctx) => {
    ctx.bl1567Source = readTestFile();
    ctx.bl1567QueueingBody = queueingSendBody(ctx.bl1567Source);
  });

  scoped(/^its queueing send exports SWARMFORGE_MAILBOX_ONLY set to 1$/, (ctx) => {
    assert.match(
      ctx.bl1567QueueingBody,
      /export SWARMFORGE_MAILBOX_ONLY=1/,
      'the queueing send does not export SWARMFORGE_MAILBOX_ONLY=1',
    );
  });

  scoped(/^its queueing send does not export SWARMFORGE_SKIP_DAEMON$/, (ctx) => {
    assert.doesNotMatch(
      ctx.bl1567QueueingBody,
      /export SWARMFORGE_SKIP_DAEMON/,
      'the queueing send still exports SWARMFORGE_SKIP_DAEMON',
    );
  });

  // ── inbound-non-forwarding-two-call-04 ──────────────────────────────────

  scoped(/^swarmforge\/scripts\/swarm_handoff\.bb on the tree as it stands is compared with main$/, (ctx) => {
    ctx.bl1567Diff = spawnSync('git', ['diff', 'main', '--', 'swarmforge/scripts/swarm_handoff.bb'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  });

  scoped(/^it is unchanged$/, (ctx) => {
    assert.equal(ctx.bl1567Diff.status, 0, `git diff failed: ${ctx.bl1567Diff.stderr}`);
    assert.equal(
      ctx.bl1567Diff.stdout.trim(),
      '',
      `swarmforge/scripts/swarm_handoff.bb differs from main:\n${ctx.bl1567Diff.stdout}`,
    );
  });

  scoped(/^the test file sets no environment variable that swarm_handoff\.bb reads to skip the audit$/, () => {
    const src = readTestFile();
    const used = new Set(src.match(/SWARMFORGE_[A-Z_]+/g) || []);
    for (const name of used) {
      assert.ok(ALLOWED_ENV_VARS.has(name), `${TEST_FILE} references unexpected env var ${name} - possible audit bypass`);
    }
  });

  // ── inbound-non-forwarding-two-call-05 ──────────────────────────────────

  scoped(/^every shell test under swarmforge\/scripts\/test that invokes swarm_handoff and drafts a git_handoff is listed$/, (ctx) => {
    ctx.bl1567Census = censusGitHandoffSendingShellTests();
  });

  scoped(/^the list names test_swarm_handoff_inbound_non_forwarding\.sh$/, (ctx) => {
    assert.ok(
      ctx.bl1567Census.includes(TEST_FILE),
      `census did not include ${TEST_FILE}: ${ctx.bl1567Census.join(', ')}`,
    );
  });

  scoped(/^the list has twelve entries$/, (ctx) => {
    assert.equal(ctx.bl1567Census.length, 12, `expected 12 entries, got ${ctx.bl1567Census.length}: ${ctx.bl1567Census.join(', ')}`);
  });
}

module.exports = { registerSteps };
