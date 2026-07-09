/**
 * BL-122: automatic agent-driven handoff recovery — unit tests.
 *
 * Depends on BL-121's detection (transportHealth.test.js). Recovery
 * re-delivers dead-lettered parcels without a human, never clobbers a busy
 * live holder's in-flight work, and escalates to a needs-human state once
 * bounded retries are exhausted rather than looping or going silent.
 * Tested entirely through fakes — no live babashka daemon or tmux.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  decideRecoveryAction,
  readRecoveryAttempts,
  writeRecoveryAttempts,
  recoverDeadLettersForRole,
  recoverDeadLetters,
  recoveryLogPath,
  appendRecoveryLog,
} = require('../out/swarm/handoffRecovery');
const { readDaemonHealth } = require('../out/swarm/daemonHealth');
const { computeLiveTransportHealth } = require('../out/swarm/transportHealth');

const CFG = { maxRecoveryAttempts: 3 };

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-handoff-recovery-'));
}

function writeDeadLetter(inboxNewDir, name, headers) {
  fs.mkdirSync(inboxNewDir, { recursive: true });
  const filePath = path.join(inboxNewDir, name);
  const header = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  fs.writeFileSync(filePath, `${header}\n\nbody`, 'utf-8');
  return filePath;
}

function noopAdapters(overrides = {}) {
  return {
    isRecipientBusy: () => false,
    sendWakeUp: () => {},
    logRemediation: () => {},
    setNeedsHuman: () => {},
    ...overrides,
  };
}

// ── decideRecoveryAction (pure) ──────────────────────────────────────────

test('decideRecoveryAction redelivers a fresh dead letter to an idle recipient', () => {
  assert.equal(decideRecoveryAction(0, false, CFG), 'redelivered');
});

test('decideRecoveryAction never re-delivers into a busy live holder (BL-109 guard)', () => {
  assert.equal(decideRecoveryAction(0, true, CFG), 'skipped-busy');
  assert.equal(decideRecoveryAction(99, true, CFG), 'skipped-busy');
});

test('decideRecoveryAction escalates once bounded retries are exhausted', () => {
  assert.equal(decideRecoveryAction(3, false, CFG), 'escalated');
  assert.equal(decideRecoveryAction(10, false, CFG), 'escalated');
});

test('decideRecoveryAction keeps redelivering under the attempt bound', () => {
  assert.equal(decideRecoveryAction(2, false, CFG), 'redelivered');
});

// ── attempts sidecar ──────────────────────────────────────────────────────

test('readRecoveryAttempts is 0 with no sidecar', () => {
  const target = mkTmp();
  assert.equal(readRecoveryAttempts(path.join(target, 'x.handoff.dead')), 0);
});

test('recovery attempts are keyed to the stable base path, not the .dead suffix', () => {
  const target = mkTmp();
  fs.mkdirSync(target, { recursive: true });
  const base = path.join(target, '00_x_from_a_to_b.handoff');
  writeRecoveryAttempts(`${base}.dead`, 2);
  assert.equal(readRecoveryAttempts(base), 2);
  assert.equal(readRecoveryAttempts(`${base}.dead`), 2);
});

// ── auto-recovery-01: redeliver without a human ──────────────────────────

test('auto-recovery-01: a dead-lettered parcel is re-delivered to its live holder, remediation logged', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  const filePath = writeDeadLetter(inboxNewDir, '00_x_from_specifier_to_coder.handoff.dead', {
    from: 'specifier',
    recipient: 'coder',
  });

  const logged = [];
  const outcomes = recoverDeadLettersForRole('coder', inboxNewDir, CFG, noopAdapters({
    logRemediation: (o) => logged.push(o),
  }));

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].action, 'redelivered');
  assert.equal(fs.existsSync(filePath), false, 'the .dead file must no longer exist');
  const restoredPath = filePath.replace(/\.dead$/, '');
  assert.equal(fs.existsSync(restoredPath), true, 'the parcel must be restored to inbox/new as an actionable handoff');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].action, 'redelivered');
});

test('auto-recovery-01: recovery restores the canary/health signal to green', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'handoffd.status.json'), '{"state":"healthy"}');

  const inboxNewDir = path.join(target, 'coder', 'inbox', 'new');
  writeDeadLetter(inboxNewDir, '00_x_from_specifier_to_coder.handoff.dead', { from: 'specifier', recipient: 'coder' });
  const roleInboxes = [{ role: 'coder', inboxNewDir, inProcessDir: path.join(target, 'coder', 'inbox', 'in_process') }];
  const now = Date.now();

  const before = computeLiveTransportHealth(target, roleInboxes, now, { stallThresholdSeconds: 300, canaryBudgetSeconds: 300 });
  assert.equal(before.state, 'delivery-degraded');

  recoverDeadLetters(roleInboxes, CFG, noopAdapters());

  const after = computeLiveTransportHealth(target, roleInboxes, now, { stallThresholdSeconds: 300, canaryBudgetSeconds: 300 });
  assert.deepEqual(after, { state: 'healthy', offending: [] });
});

// ── RE-SCOPE (c): chase-then-recover race guard ──────────────────────────

test('RE-SCOPE(c): redelivery resets the daemon chase sidecar and mtime so the next chase sweep cannot immediately re-dead-letter it', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  const filePath = writeDeadLetter(inboxNewDir, '00_x_from_specifier_to_coder.handoff.dead', {
    from: 'specifier',
    recipient: 'coder',
  });
  const restoredPath = filePath.replace(/\.dead$/, '');

  // The daemon's own chase sidecar, carried over from before dead-lettering:
  // chase-count already at the dead-letter threshold (that's WHY the daemon
  // dead-lettered it), and a stale mtime from the original delivery.
  fs.writeFileSync(`${filePath}.chase.json`, JSON.stringify({ chaseCount: 3, lastChasedAtMs: Date.now() - 60_000 }));
  const staleSeconds = (Date.now() - 60 * 60 * 1000) / 1000;
  fs.utimesSync(filePath, staleSeconds, staleSeconds);

  recoverDeadLettersForRole('coder', inboxNewDir, CFG, noopAdapters());

  assert.equal(
    fs.existsSync(`${restoredPath}.chase.json`),
    false,
    'an exhausted chase-count must not carry onto the restored parcel - the daemon would dead-letter it again on its very next sweep'
  );
  const mtimeMs = fs.statSync(restoredPath).mtimeMs;
  assert(
    Date.now() - mtimeMs < 5000,
    'the restored parcel must look freshly delivered, not still aged past the dead-letter threshold'
  );
});

// ── idempotent-redelivery-02 ──────────────────────────────────────────────

test('idempotent-redelivery-02: sweeping twice after redelivery cannot duplicate the parcel', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  writeDeadLetter(inboxNewDir, '00_x_from_specifier_to_coder.handoff.dead', { from: 'specifier', recipient: 'coder' });

  const firstOutcomes = recoverDeadLettersForRole('coder', inboxNewDir, CFG, noopAdapters());
  assert.equal(firstOutcomes.length, 1);
  assert.equal(firstOutcomes[0].action, 'redelivered');

  // Second sweep: nothing left in .dead form, so nothing to act on — the
  // recipient sees exactly one actionable copy, never two.
  const secondOutcomes = recoverDeadLettersForRole('coder', inboxNewDir, CFG, noopAdapters());
  assert.deepEqual(secondOutcomes, []);

  const entries = fs.readdirSync(inboxNewDir).filter((f) => f.endsWith('.handoff'));
  assert.equal(entries.length, 1, 'exactly one actionable handoff, never a duplicate');
});

// ── busy-holder-guard-03 ──────────────────────────────────────────────────

test('busy-holder-guard-03: recovery never re-delivers into an actively-processing live holder', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  const filePath = writeDeadLetter(inboxNewDir, '00_x_from_specifier_to_coder.handoff.dead', {
    from: 'specifier',
    recipient: 'coder',
  });

  const outcomes = recoverDeadLettersForRole('coder', inboxNewDir, CFG, noopAdapters({ isRecipientBusy: () => true }));

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].action, 'skipped-busy');
  assert.equal(fs.existsSync(filePath), true, 'the dead letter must be left untouched, not lost');
});

// ── escalation-04 ─────────────────────────────────────────────────────────

test('escalation-04: exhausted retries escalate to a needs-human state instead of looping silently', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  const filePath = writeDeadLetter(inboxNewDir, '00_x_from_specifier_to_coder.handoff.dead', {
    from: 'specifier',
    recipient: 'coder',
  });
  writeRecoveryAttempts(filePath, CFG.maxRecoveryAttempts);

  const escalations = [];
  const logged = [];
  const outcomes = recoverDeadLettersForRole('coder', inboxNewDir, CFG, noopAdapters({
    setNeedsHuman: (role, needsHuman) => escalations.push({ role, needsHuman }),
    logRemediation: (o) => logged.push(o),
  }));

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].action, 'escalated');
  assert.equal(fs.existsSync(filePath), true, 'an escalated parcel is surfaced, not silently discarded from failed/');
  assert.deepEqual(escalations, [{ role: 'coder', needsHuman: true }]);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].attempts, CFG.maxRecoveryAttempts);
});

// ── recoverDeadLetters across multiple roles ──────────────────────────────

test('recoverDeadLetters sweeps every role inbox, not just one', () => {
  const target = mkTmp();
  const coderInbox = path.join(target, 'coder', 'inbox', 'new');
  const cleanerInbox = path.join(target, 'cleaner', 'inbox', 'new');
  writeDeadLetter(coderInbox, '00_x_from_specifier_to_coder.handoff.dead', { from: 'specifier', recipient: 'coder' });
  writeDeadLetter(cleanerInbox, '00_x_from_coder_to_cleaner.handoff.dead', { from: 'coder', recipient: 'cleaner' });

  const outcomes = recoverDeadLetters(
    [
      { role: 'coder', inboxNewDir: coderInbox },
      { role: 'cleaner', inboxNewDir: cleanerInbox },
    ],
    CFG,
    noopAdapters()
  );

  assert.equal(outcomes.length, 2);
  assert.deepEqual(outcomes.map((o) => o.action).sort(), ['redelivered', 'redelivered']);
});

// ── durable remediation log ────────────────────────────────────────────────

test('recoveryLogPath points at .swarmforge/daemon/recovery.log under the target', () => {
  const target = mkTmp();
  assert.equal(recoveryLogPath(target), path.join(target, '.swarmforge', 'daemon', 'recovery.log'));
});

test('appendRecoveryLog creates the daemon dir and appends one JSON line per call, each with a timestamp', () => {
  const target = mkTmp();
  const outcome = { role: 'coder', filePath: '/x/00_a.handoff', action: 'redelivered', attempts: 1 };

  appendRecoveryLog(target, outcome);
  appendRecoveryLog(target, { ...outcome, action: 'escalated', attempts: 3 });

  const lines = fs.readFileSync(recoveryLogPath(target), 'utf-8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.role, 'coder');
  assert.equal(first.action, 'redelivered');
  assert.equal(typeof first.at, 'string');
  const second = JSON.parse(lines[1]);
  assert.equal(second.action, 'escalated');
  assert.equal(second.attempts, 3);
});
