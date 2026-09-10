'use strict';

// BL-1497: step handlers for "A commit-integrity lock whose holder died is
// reaped, and a live holder's lock never is" - driven directly against the
// REAL commit_integrity_cli.bb / commit_integrity_lib.bb (never a
// reimplementation of the reap decision):
//
//   - scenarios 01-03 run the REAL production commit_integrity_cli.bb
//     against a planted lock directory in a fixture repo - the wiring
//     proof the ticket itself calls for (a fix living only inside
//     acquire-lock! cannot be anchored any other way, BL-1235).
//   - scenario 04 runs a small acceptance seam
//     (commit_integrity_1497_scenarios_cli.bb) that injects ONLY
//     :commit-fn!, mirroring the BL-856/BL-1475 acceptance seam precedent
//     for this same library - it snapshots the lock directory's owner
//     record from INSIDE the injected commit step, which runs strictly
//     between the real acquire-lock! and release-lock!, so "while the
//     commit step is held" needs no thread, sleep, or race.
//
// Never plants a lock in the live checkout - every fixture is a fresh
// mkdtemp git repo (BL-1390).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS_DIR, 'commit_integrity_cli.bb');
const SCENARIOS_CLI = path.join(SCRIPTS_DIR, 'test', 'commit_integrity_1497_scenarios_cli.bb');
const FEATURE = "BL-1497 A commit-integrity lock whose holder died is reaped, and a live holder's lock never is";

// A lock age this far past the derived floor (never below 300s per the
// ticket's own approval context) is unambiguously "past the age bound"
// whatever the exact bound - never hardcodes commit_integrity_lib.bb's own
// literal, which would duplicate that constant across the language
// boundary (BL-897).
const CLEARLY_PAST_BOUND_MS = 60 * 60 * 1000; // 1 hour
const CLEARLY_WITHIN_BOUND_MS = 1000; // 1 second

const KNOWN_AGES = new Set(['past', 'within']);
const KNOWN_RESULTS = new Set(['success', 'lock-timeout']);
const KNOWN_STATES = new Set(['absent', 'present']);
const KNOWN_ROWS = new Set(['past|success|absent', 'within|lock-timeout|present']);

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function mkGitRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1497-')));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return dir;
}

function lockDirFor(dir) {
  const gitCommonDir = execFileSync('git', ['-C', dir, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  return path.join(gitCommonDir, 'swarmforge-commit-integrity.lock');
}

// A guaranteed-dead pid: the subshell has already exited by the time this
// synchronous call returns its own $$ (the ticket's own qa_e2e_procedure
// names this exact idiom).
function deadPid() {
  return Number(execFileSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' }).trim());
}

function writeOwnerRecord(lockDir, pid) {
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid, created_at_ms: Date.now() }));
}

function runProductionCli(dir, relPath) {
  const args = [CLI, dir, '--message', 'Approve BL-1497-fixture', '--path', relPath];
  let stdout;
  let failed = false;
  try {
    stdout = execFileSync('bb', args, { encoding: 'utf8' });
  } catch (err) {
    failed = true;
    stdout = err.stdout;
  }
  return { parsed: JSON.parse(stdout), processFailed: failed };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture repository with a shared checkout and one ticket YAML edited on disk$/, (ctx) => {
    ctx.dir = mkGitRepo();
    ctx.ticketRelPath = 'ticket.yaml';
    ctx.lockDir = lockDirFor(ctx.dir);
    fs.writeFileSync(path.join(ctx.dir, ctx.ticketRelPath), 'human_approval: pending\n');
    git(ctx.dir, ['add', '--', ctx.ticketRelPath]);
    git(ctx.dir, ['commit', '-q', '-m', 'seed ticket']);
    // A genuinely new value - never byte-identical to the seed - so a
    // real "nothing to commit" never masquerades as the scenario under
    // test (same discipline as BL-1475's own Background).
    fs.writeFileSync(path.join(ctx.dir, ctx.ticketRelPath), 'human_approval: approved\n');
  });

  // ── scenario 01 Given ────────────────────────────────────────────────
  scoped(/^the lock directory exists and its owner record names a process that has exited$/, (ctx) => {
    ctx.deadOwnerPid = deadPid();
    writeOwnerRecord(ctx.lockDir, ctx.deadOwnerPid);
  });

  // ── scenario 02 Given ────────────────────────────────────────────────
  scoped(/^the lock directory exists and its owner record names a process that is still running$/, (ctx) => {
    ctx.liveOwnerProc = spawn('sleep', ['300']);
    ctx.liveOwnerPid = ctx.liveOwnerProc.pid;
    writeOwnerRecord(ctx.lockDir, ctx.liveOwnerPid);
  });

  // ── scenario 03 (outline) Given ──────────────────────────────────────
  scoped(/^the lock directory exists with no owner record and its age is (past|within) the age bound$/, (ctx, age) => {
    assert.ok(KNOWN_AGES.has(age), `unknown Outline age cell: ${age}`);
    ctx.recordlessAge = age;
    fs.mkdirSync(ctx.lockDir, { recursive: true });
    const ageMs = age === 'past' ? CLEARLY_PAST_BOUND_MS : CLEARLY_WITHIN_BOUND_MS;
    const past = new Date(Date.now() - ageMs);
    fs.utimesSync(ctx.lockDir, past, past);
  });

  // ── scenario 04 Given ────────────────────────────────────────────────
  scoped(/^no lock directory exists$/, (ctx) => {
    assert.ok(!fs.existsSync(ctx.lockDir), 'expected the Background to leave no lock directory');
  });

  // ── scenarios 01-03 When ─────────────────────────────────────────────
  scoped(/^a writer commits the ticket YAML through the commit-integrity CLI$/, (ctx) => {
    ctx.result = runProductionCli(ctx.dir, ctx.ticketRelPath);
  });

  // ── scenario 04 When ─────────────────────────────────────────────────
  scoped(/^a writer commits the ticket YAML with its commit step held open$/, (ctx) => {
    ctx.snapshotPath = path.join(ctx.dir, 'bl1497-snapshot.json');
    const args = [
      SCENARIOS_CLI,
      ctx.dir,
      '--message',
      'Approve BL-1497-fixture-04',
      '--path',
      ctx.ticketRelPath,
      '--snapshot-path',
      ctx.snapshotPath,
    ];
    let stdout;
    let failed = false;
    try {
      stdout = execFileSync('bb', args, { encoding: 'utf8' });
    } catch (err) {
      failed = true;
      stdout = err.stdout;
    }
    ctx.result = { parsed: JSON.parse(stdout), processFailed: failed };
    ctx.snapshot = JSON.parse(fs.readFileSync(ctx.snapshotPath, 'utf8'));
  });

  // ── scenario 01 Then ─────────────────────────────────────────────────
  scoped(/^the commit lands on the first attempt$/, (ctx) => {
    assert.equal(ctx.result.processFailed, false, `expected the commit to succeed, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.parsed.success, true);
    assert.equal(ctx.result.parsed.attempts, 1);
  });

  scoped(/^the result names the reaped lock's dead owner$/, (ctx) => {
    const reaped = ctx.result.parsed['reaped-lock'];
    assert.ok(reaped, `expected a reaped-lock field, got: ${JSON.stringify(ctx.result.parsed)}`);
    assert.equal(reaped.reason, 'dead-owner');
    assert.equal(reaped.pid, ctx.deadOwnerPid);
  });

  // ── scenario 02 Then ─────────────────────────────────────────────────
  scoped(/^the result is lock-timeout with no attempt made$/, (ctx) => {
    assert.equal(ctx.result.processFailed, true, `expected a failed process (lock-timeout), got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.parsed.success, false);
    assert.equal(ctx.result.parsed.reason, 'lock-timeout');
    assert.equal(ctx.result.parsed.attempts, 0);
  });

  scoped(/^the lock directory still names the same owner afterwards$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.lockDir), 'expected the lock directory to still exist');
    const record = JSON.parse(fs.readFileSync(path.join(ctx.lockDir, 'owner.json'), 'utf8'));
    assert.equal(record.pid, ctx.liveOwnerPid);
    ctx.liveOwnerProc.kill();
  });

  // ── scenario 03 (outline) Then ───────────────────────────────────────
  scoped(/^the result is (success|lock-timeout)$/, (ctx, result) => {
    assert.ok(KNOWN_RESULTS.has(result), `unknown Outline result cell: ${result}`);
    const rowKey = `${ctx.recordlessAge}|${result}`;
    assert.ok(
      [...KNOWN_ROWS].some((row) => row.startsWith(rowKey)),
      `unknown Outline row: ${rowKey}`
    );
    if (result === 'success') {
      assert.equal(ctx.result.processFailed, false, `expected success, got: ${JSON.stringify(ctx.result)}`);
      assert.equal(ctx.result.parsed.success, true);
      assert.equal(ctx.result.parsed['reaped-lock'] && ctx.result.parsed['reaped-lock'].reason, 'record-less-past-bound');
    } else {
      assert.equal(ctx.result.processFailed, true, `expected lock-timeout, got: ${JSON.stringify(ctx.result)}`);
      assert.equal(ctx.result.parsed.success, false);
      assert.equal(ctx.result.parsed.reason, 'lock-timeout');
    }
  });

  // Shared by scenarios 01, 04 (fixed "absent") and the scenario 03
  // Outline (both rows) - the assertion is the same fact either way; the
  // Outline row is validated against KNOWN_VALUES only when this step came
  // from the Outline (ctx.recordlessAge set by its own Given step).
  scoped(/^the lock directory is (absent|present) afterwards$/, (ctx, state) => {
    assert.ok(KNOWN_STATES.has(state), `unknown Outline state cell: ${state}`);
    if (ctx.recordlessAge) {
      const rowKey = `${ctx.recordlessAge}|${state}`;
      assert.ok(rowKey === 'past|absent' || rowKey === 'within|present', `unknown Outline row: ${rowKey}`);
    }
    assert.equal(fs.existsSync(ctx.lockDir), state === 'present');
  });

  // ── scenario 04 Then ─────────────────────────────────────────────────
  scoped(/^while the commit step is held the lock directory's owner record names the writer's own process$/, (ctx) => {
    assert.equal(ctx.snapshot['lock-dir-exists'], true);
    assert.ok(ctx.snapshot['owner-record'], `expected an owner record mid-commit, got: ${JSON.stringify(ctx.snapshot)}`);
    assert.equal(ctx.snapshot['owner-record'].pid, ctx.snapshot['self-pid']);
  });
}

module.exports = { registerSteps };
