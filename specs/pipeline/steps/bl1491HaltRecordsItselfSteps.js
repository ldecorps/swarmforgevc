'use strict';

// BL-1491: step handlers for "a supervisor halt records itself on the
// ledgers a stop already uses". Drives the REAL daemon_alarm_lib.bb
// alarm-and-halt! through the REAL handoffd_supervisor.bb record-halt!
// (kill-all-audit row + availability stop record) via
// bl1491HaltRecordsItselfCli.bb - never a reimplementation. halt-swarm! is
// stubbed inside the CLI so a real tmux kill is never reached; the alarm
// email is suppressed by daemon_alarm_lib.bb's own test-fixture-root?
// fail-safe (the fixture root is always under the system temp dir).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'lib', 'bl1491HaltRecordsItselfCli.bb');

const FEATURE = 'BL-1491 a supervisor halt records itself on the ledgers a stop already uses';

function ensureCtx(ctx) {
  ctx.telemetryUnwritable = ctx.telemetryUnwritable || false;
  return ctx;
}

function runFixture(ctx, reason, { appendStart } = {}) {
  ensureCtx(ctx);
  const input = JSON.stringify({
    reason,
    'telemetry-unwritable': ctx.telemetryUnwritable,
    'append-start': !!appendStart,
  });
  const result = spawnSync('bb', [CLI], {
    input,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `expected the fixture CLI to exit 0, got ${result.status}: ${result.stderr}`);
  ctx.result = JSON.parse(result.stdout.trim().split('\n').pop());
  return ctx.result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project root with no tmux socket file$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^a supervisor whose alarm email and swarm halt are recorded, not performed$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^the telemetry directory is not writable$/, (ctx) => {
    ensureCtx(ctx);
    ctx.telemetryUnwritable = true;
  });

  scoped(/^the supervisor runs alarm-and-halt for the "([^"]+)" verdict$/, (ctx, verdict) => {
    runFixture(ctx, verdict);
  });

  scoped(/^a swarm start record follows it in the ledger$/, (ctx) => {
    runFixture(ctx, 'stalled', { appendStart: true });
  });

  scoped(/^the daemon directory's kill-all-audit log gains exactly one row$/, (ctx) => {
    assert.equal(ctx.result.auditLines.length, 1,
      `expected exactly one kill-all-audit row, got ${JSON.stringify(ctx.result.auditLines)}`);
  });

  scoped(/^that row names "([^"]+)" and "([^"]+)"$/, (ctx, name, verdict) => {
    const row = ctx.result.auditLines[0] || '';
    assert.ok(row.includes(name), `expected the audit row to name "${name}", got: ${row}`);
    assert.ok(row.includes(verdict), `expected the audit row to name "${verdict}", got: ${row}`);
    assert.ok(ctx.result.auditRowNamesReason, 'expected auditRowNamesReason to be true');
  });

  scoped(/^the current month's availability ledger gains exactly one "stop" record of class "([^"]+)" whose source names "([^"]+)"$/,
    (ctx, cls, source) => {
      assert.equal(ctx.result.stopRecordCount, 1,
        `expected exactly one stop record, got ${ctx.result.stopRecordCount}`);
      assert.equal(ctx.result.stopRecordClass, cls,
        `expected stop record class "${cls}", got ${ctx.result.stopRecordClass}`);
      assert.equal(ctx.result.stopRecordSource, source,
        `expected stop record source "${source}", got ${ctx.result.stopRecordSource}`);
    });

  scoped(/^the ledger reader folds them into one "([^"]+)" interval with provenance "([^"]+)"$/,
    (ctx, cls, provenance) => {
      const matches = ctx.result.foldedIntervals.filter((iv) => iv.class === cls && iv.provenance === provenance);
      assert.equal(matches.length, 1,
        `expected exactly one folded "${cls}" interval with provenance "${provenance}", got ${JSON.stringify(ctx.result.foldedIntervals)}`);
    });

  scoped(/^both records already exist at the moment the swarm halt is invoked$/, (ctx) => {
    assert.ok(ctx.result.bothExistAtHalt, 'expected bothExistAtHalt to have been sampled');
    assert.equal(ctx.result.bothExistAtHalt.audit, true,
      `expected the kill-all-audit row to already exist at halt time: ${JSON.stringify(ctx.result.bothExistAtHalt)}`);
    assert.equal(ctx.result.bothExistAtHalt.availability, true,
      `expected the availability stop record to already exist at halt time: ${JSON.stringify(ctx.result.bothExistAtHalt)}`);
  });

  scoped(/^the swarm halt is invoked once$/, (ctx) => {
    assert.equal(ctx.result.haltCount, 1, `expected exactly one halt, got ${ctx.result.haltCount}`);
  });

  scoped(/^the failure log is still written$/, (ctx) => {
    assert.equal(ctx.result.failureLogWritten, true, 'expected the failure log to still be written');
  });
}

module.exports = { registerSteps };
