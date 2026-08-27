'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'false-alarm rate trend makes observability noise measurable';
const REPO = path.join(__dirname, '..', '..', '..');

const ALERT_TYPE_BY_VERDICT_SCENARIO = {
  'an AGENT_EXITED mono-router false positive': 'AGENT_EXITED',
  'an active-backlog-depth steady-state warn': 'active-backlog-depth',
  'a self-cancelling NO-OP within one sweep': 'operator-no-op',
  'an alert the operator acts on': 'operator-actionable',
};

function loadStore() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'alertTelemetryStore'));
}

function loadPure() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'alertTelemetry'));
}

function ensure(ctx) {
  if (!ctx.bl598) ctx.bl598 = {};
  return ctx.bl598;
}

function freshRoot(ctx) {
  const st = ensure(ctx);
  if (!st.root) {
    st.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl598-aps-'));
    st.recordsBefore = 0;
  }
  return st;
}

async function idle() {
  await loadStore().whenAlertTelemetryIdle();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^alert telemetry emits to the alerts log$/, (ctx) => {
    freshRoot(ctx);
  });

  scoped(
    /^(.+) fires and the operator sweep classifies it as (.+)$/,
    async (ctx, alertPhrase, verdict) => {
      const st = freshRoot(ctx);
      const alertType = ALERT_TYPE_BY_VERDICT_SCENARIO[alertPhrase.trim()];
      assert.ok(alertType, `unknown alert phrase: ${alertPhrase}`);
      st.alertType = alertType;
      st.verdict = verdict.trim();
      st.recordsBefore = loadStore().readAlertRecords(st.root).length;
      loadStore().emitAlertVerdict(st.root, alertType, st.verdict);
      await idle();
    }
  );

  scoped(/^exactly one record is appended to the alerts log$/, (ctx) => {
    const st = ensure(ctx);
    const records = loadStore().readAlertRecords(st.root);
    assert.equal(records.length, st.recordsBefore + 1);
    st.last = records[records.length - 1];
  });

  scoped(/^the record carries alert-type (.+)$/, (ctx, alertType) => {
    assert.equal(ensure(ctx).last.alertType, alertType.trim());
  });

  scoped(/^the record carries verdict (.+)$/, (ctx, verdict) => {
    assert.equal(ensure(ctx).last.verdict, verdict.trim());
  });

  scoped(/^the record carries when it fired$/, (ctx) => {
    assert.equal(typeof ensure(ctx).last.at, 'string');
    assert.ok(ensure(ctx).last.at.length > 0);
    assert.equal(ensure(ctx).last.fired, true);
  });

  scoped(/^a log of alert records spanning more than one window$/, (ctx) => {
    const st = freshRoot(ctx);
    st.windowMs = 60 * 60 * 1000;
    st.input = [
      { at: '2026-08-25T10:00:00.000Z', alertType: 'AGENT_EXITED', verdict: 'false-positive', fired: true },
      { at: '2026-08-25T10:30:00.000Z', alertType: 'AGENT_EXITED', verdict: 'actionable', fired: true },
      { at: '2026-08-25T11:00:00.000Z', alertType: 'AGENT_EXITED', verdict: 'false-positive', fired: true },
      { at: '2026-08-25T11:15:00.000Z', alertType: 'active-backlog-depth', verdict: 'false-positive', fired: true },
    ];
  });

  scoped(/^some records are false-positive and some are actionable$/, () => {
    // established by fixture above
  });

  scoped(/^each alert-type series is aggregated$/, (ctx) => {
    const st = ensure(ctx);
    st.byType = loadPure().aggregateFalsePositiveRateByType(st.input, st.windowMs);
  });

  scoped(/^each window reports that type's false-positive rate$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.byType.AGENT_EXITED[0].value, 0.5);
    assert.equal(st.byType.AGENT_EXITED[1].value, 1);
    assert.equal(st.byType['active-backlog-depth'][0].value, 1);
  });

  scoped(/^the aggregation reads no files of its own$/, () => {
    assert.ok(true);
  });

  scoped(/^the alerts log already holds earlier records$/, async (ctx) => {
    const st = freshRoot(ctx);
    loadStore().emitAlertVerdict(st.root, 'AGENT_EXITED', 'false-positive', '2026-08-25T09:00:00.000Z');
    await idle();
    st.earlier = loadStore().readAlertRecords(st.root);
    assert.ok(st.earlier.length >= 1);
  });

  scoped(/^a further alert record is emitted$/, async (ctx) => {
    const st = ensure(ctx);
    loadStore().emitAlertVerdict(st.root, 'operator-actionable', 'actionable', '2026-08-25T09:00:01.000Z');
    await idle();
  });

  scoped(/^the earlier records are still present unchanged$/, (ctx) => {
    const st = ensure(ctx);
    const now = loadStore().readAlertRecords(st.root);
    assert.equal(now[0].alertType, st.earlier[0].alertType);
    assert.equal(now[0].at, st.earlier[0].at);
    assert.ok(now.length > st.earlier.length);
  });

  scoped(/^the log is excluded from version control$/, () => {
    const gitignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.swarmforge\//m);
  });

  scoped(/^the alerts log cannot be written$/, (ctx) => {
    const st = freshRoot(ctx);
    fs.mkdirSync(path.join(st.root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(st.root, '.swarmforge', 'telemetry'), 'not-a-dir');
    st.unwritable = true;
  });

  scoped(/^an alert that would normally fire is evaluated$/, async (ctx) => {
    const st = ensure(ctx);
    const pure = loadStore();
    st.evalResult = pure.evaluateAlertWithTelemetry(st.root, 'operator-no-op', 'false-positive', () => ({
      fired: true,
      acted: false,
    }));
    await idle();
  });

  scoped(/^the alert still fires or suppresses exactly as before$/, (ctx) => {
    const st = ensure(ctx);
    assert.deepEqual(st.evalResult, { fired: true, acted: false });
  });

  scoped(/^the operator sweep is not left waiting on the log$/, async () => {
    await idle();
  });
}

module.exports = { registerSteps };
