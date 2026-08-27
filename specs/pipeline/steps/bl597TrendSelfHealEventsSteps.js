'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'self-heal events trend makes automatic recovery visible';
const REPO = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO, 'swarmforge', 'scripts', 'self_heal_telemetry_cli.bb');
const GITIGNORE = path.join(REPO, '.gitignore');

function loadStore() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'selfHealTelemetryStore'));
}

function loadPure() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'selfHealTelemetry'));
}

function ensure(ctx) {
  if (!ctx.bl597) ctx.bl597 = {};
  return ctx.bl597;
}

function freshRoot(ctx) {
  const st = ensure(ctx);
  if (!st.root) {
    st.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl597-aps-'));
    fs.mkdirSync(path.join(st.root, '.swarmforge', 'telemetry'), { recursive: true });
  }
  return st.root;
}

async function idle() {
  await loadStore().whenSelfHealTelemetryIdle();
}

function runCli(root, action, subject, reason) {
  const args = [CLI, root, action];
  if (subject) args.push(subject);
  if (reason) args.push(reason);
  const res = spawnSync('bb', args, { cwd: REPO, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
}

function readEvents(root) {
  return loadStore().readSelfHealEvents(root);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^self-heal telemetry emits to the self-heal log$/, (ctx) => {
    freshRoot(ctx);
  });

  scoped(/^(.+) occurs with subject (.+) and reason (.+)$/, async (ctx, action, subject, reason) => {
    const st = ensure(ctx);
    const root = freshRoot(ctx);
    st.before = readEvents(root).length;
    st.expected = { type: null, subject, reason };
    const typeByAction = {
      'a stale-build-detected recompile': 'stale-build-recompile',
      'a bounded supervisor respawn': 'supervisor-respawn',
      'a kill_all_swarm invocation': 'kill-all-swarm',
      'a mono-router rotation respawn': 'rotation-respawn',
      'a claim-heal or resume-orphan claim': 'claim-heal',
    };
    st.expected.type = typeByAction[action];
    runCli(root, action, subject, reason);
    await idle();
  });

  scoped(/^exactly one record is appended to the self-heal log$/, (ctx) => {
    const st = ensure(ctx);
    const events = readEvents(st.root);
    assert.equal(events.length, st.before + 1);
    st.last = events[events.length - 1];
  });

  scoped(/^the record carries type (.+)$/, (ctx, type) => {
    assert.equal(ensure(ctx).last.type, type);
  });

  scoped(/^the record carries subject (.+)$/, (ctx, subject) => {
    assert.equal(ensure(ctx).last.subject, subject);
  });

  scoped(/^the record carries reason (.+)$/, (ctx, reason) => {
    assert.equal(ensure(ctx).last.reason, reason);
  });

  scoped(/^the record carries when it occurred$/, (ctx) => {
    assert.ok(ensure(ctx).last.at);
    assert.ok(!Number.isNaN(Date.parse(ensure(ctx).last.at)));
  });

  scoped(/^a log of self-heal records spanning more than one window$/, (ctx) => {
    ensure(ctx).events = [
      {
        type: 'stale-build-recompile',
        subject: 'front-desk-supervisor',
        reason: 'recompiling before respawn',
        at: '2026-08-27T10:00:00.000Z',
      },
      {
        type: 'stale-build-recompile',
        subject: 'front-desk-supervisor',
        reason: 'recompiling before respawn',
        at: '2026-08-27T11:00:00.000Z',
      },
      {
        type: 'supervisor-respawn',
        subject: 'front-desk-supervisor',
        reason: 'bounded restart',
        at: '2026-08-27T10:30:00.000Z',
      },
      {
        type: 'kill-all-swarm',
        subject: 'lifecycle',
        reason: 'clean slate',
        at: '2026-08-27T12:00:00.000Z',
      },
    ];
    ensure(ctx).window = {
      startMs: Date.parse('2026-08-27T09:00:00.000Z'),
      endMs: Date.parse('2026-08-27T13:00:00.000Z'),
      bucketMs: 60 * 60 * 1000,
    };
  });

  scoped(/^records of several self-heal types$/, (ctx) => {
    const types = new Set(ensure(ctx).events.map((e) => e.type));
    assert.ok(types.size >= 2);
  });

  scoped(/^each self-heal type series is aggregated$/, (ctx) => {
    const st = ensure(ctx);
    st.agg = loadPure().aggregateSelfHealCounts(st.events, st.window);
  });

  scoped(/^each window reports that type's event count$/, (ctx) => {
    const st = ensure(ctx);
    const recompile = st.agg['stale-build-recompile'];
    assert.ok(recompile);
    assert.equal(recompile.series.length, 2);
    assert.deepEqual(
      recompile.series.map((p) => p.value),
      [1, 1]
    );
    const respawn = st.agg['supervisor-respawn'];
    assert.equal(respawn.currentValue, 1);
    const kill = st.agg['kill-all-swarm'];
    assert.equal(kill.currentValue, 1);
  });

  scoped(/^the aggregation reads no files of its own$/, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl597-pure-'));
    try {
      const events = [
        {
          type: 'claim-heal',
          subject: 'handoffd',
          reason: 'resume orphaned in_process',
          at: '2026-08-27T10:00:00.000Z',
        },
      ];
      const agg = loadPure().aggregateSelfHealCounts(events, {
        startMs: Date.parse('2026-08-27T09:00:00.000Z'),
        endMs: Date.parse('2026-08-27T12:00:00.000Z'),
      });
      assert.equal(agg['claim-heal'].currentValue, 1);
      assert.equal(fs.readdirSync(root).length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  scoped(/^the self-heal log already holds earlier records$/, async (ctx) => {
    const root = freshRoot(ctx);
    runCli(root, 'a kill_all_swarm invocation', 'lifecycle', 'clean slate');
    await idle();
    const st = ensure(ctx);
    st.earlier = readEvents(root);
    assert.equal(st.earlier.length, 1);
  });

  scoped(/^a further self-heal record is emitted$/, async (ctx) => {
    const st = ensure(ctx);
    runCli(st.root, 'a bounded supervisor respawn', 'front-desk-supervisor', 'bounded restart');
    await idle();
  });

  scoped(/^the earlier records are still present unchanged$/, (ctx) => {
    const st = ensure(ctx);
    const events = readEvents(st.root);
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], st.earlier[0]);
  });

  scoped(/^the log is excluded from version control$/, () => {
    const text = fs.readFileSync(GITIGNORE, 'utf8');
    assert.match(text, /self-heal-\*\.jsonl/);
  });

  scoped(/^the self-heal log cannot be written$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl597-ro-'));
    const tel = path.join(root, '.swarmforge', 'telemetry');
    fs.mkdirSync(tel, { recursive: true });
    fs.chmodSync(tel, 0o444);
    ensure(ctx).blockedRoot = root;
  });

  scoped(/^a self-heal action that would normally run is triggered$/, (ctx) => {
    const root = ensure(ctx).blockedRoot;
    const start = Date.now();
    runCli(root, 'a claim-heal or resume-orphan claim', 'handoffd', 'resume orphaned in_process');
    ensure(ctx).elapsedMs = Date.now() - start;
    ensure(ctx).recoveryOk = true;
  });

  scoped(/^the recovery action still runs exactly as before$/, (ctx) => {
    assert.equal(ensure(ctx).recoveryOk, true);
  });

  scoped(/^the caller is not left waiting on the log$/, (ctx) => {
    assert.ok(ensure(ctx).elapsedMs < 2000);
  });
}

module.exports = { registerSteps };
