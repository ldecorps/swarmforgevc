'use strict';

// BL-827: step handlers for "the flow watchdog measures each hop against
// that hop's own history". Drives the REAL functions in
// swarmforge/scripts/flow_watchdog_lib.bb (calibration, resolution,
// decide-tier, format-alarm-text, run-sweep!) via `bb -e` over on-disk
// fixture trees - the same posture as bl577FlowWatchdogParcelAgeInvariantSteps.js.
// Clocks are pinned (NOW_MS); the 6h recalibration interval is never slept
// out - staleness is arranged by writing calibratedAt directly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'flow_watchdog_lib.bb');
const FEATURE = 'the flow watchdog measures each hop against that hop\'s own history';

const NOW_ISO = '2026-08-19T12:00:00Z';
const NOW_MS = Date.parse(NOW_ISO);
const GLOBAL_WARN_MS = 900000; // conf-pinned 15m
const GLOBAL_ESCALATE_MS = 3600000;

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function bbEval(expr) {
  const code = `(load-file "${LIB}") (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl827-'));
  trackedRoots.push(root);
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config flow_watchdog_warn_ms ${GLOBAL_WARN_MS}\nconfig flow_watchdog_escalate_ms ${GLOBAL_ESCALATE_MS}\n`
  );
  ctx.root = root;
  ctx.daemonDir = path.join(root, '.swarmforge', 'daemon');
  ctx.newDir = path.join(root, 'architect', 'inbox', 'new');
  ctx.inProcessDir = path.join(root, 'architect', 'inbox', 'in_process');
  ctx.completedDir = path.join(root, 'architect', 'inbox', 'completed');
}

function writeHandoff(dir, name, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(path.join(dir, `${name}.handoff`), `${lines}\n\nbody\n`);
}

// Seed `count` completed hops on from->architect|git_handoff whose mailbox
// residences START at residenceSeconds and spread by one minute per sample,
// so the p67 warn and p97 escalate land visibly apart (a 1-second spread
// would put every parcel past BOTH tiers at once).
function seedHistory(ctx, { from = 'cleaner', count, residenceSeconds }) {
  for (let i = 0; i < count; i += 1) {
    const enq = new Date(NOW_MS - 86400000).toISOString();
    const comp = new Date(NOW_MS - 86400000 + residenceSeconds * 1000 + i * 60000).toISOString();
    writeHandoff(ctx.completedDir, `hist-${from}-${i}`, {
      id: `hist-${from}-${i}`,
      from,
      to: 'architect',
      type: 'git_handoff',
      enqueued_at: enq,
      completed_at: comp,
    });
  }
}

function writeLiveParcel(ctx, { id = 'live', from = ctx.parcelFrom ?? 'cleaner', ageSeconds }) {
  writeHandoff(ctx.newDir, id, {
    id,
    from,
    to: 'architect',
    type: 'git_handoff',
    enqueued_at: new Date(NOW_MS - ageSeconds * 1000).toISOString(),
  });
}

// For an expr whose bb-side value should come back as JSON (mirrors
// bl577's own bbEvalJson convention) - printed verbatim, never pr-str'd.
function bbEvalJson(expr) {
  const code = `(load-file "${LIB}") (println (cheshire.core/generate-string ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval (json) failed for: ${expr}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

// One real run-sweep! over the fixture; returns the emitted alarm texts.
// ctx.calibBreak (scenario 06) hands the sweep a completed-dir value that
// makes calibration THROW inside ensure-threshold-table!'s own try - the
// documented degrade path, injected through the argument seam (never chmod).
function runSweep(ctx) {
  const breakAdapter = ctx.calibBreak
    ? ':calibration-collect-fn (fn [_dirs] (throw (ex-info "calibration collect failed (fixture)" {})))'
    : '';
  return bbEvalJson(`(let [alarms (atom [])]
    (flow-watchdog-lib/run-sweep!
     [{:role "architect"
       :new-dir ${JSON.stringify(ctx.newDir)}
       :in-process-dir ${JSON.stringify(ctx.inProcessDir)}
       :completed-dir ${JSON.stringify(ctx.completedDir)}}]
     ${NOW_MS} ${JSON.stringify(ctx.root)} ${JSON.stringify(ctx.daemonDir)}
     {:live-session? (fn [_role] false)
      :emit-alarm! (fn [text] (swap! alarms conj text) true)
      ${breakAdapter}})
    (mapv str @alarms))`);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a daemon state directory and a project config with the global warn and escalate pair$/,
    (ctx) => {
      mkFixture(ctx);
    },
    FEATURE
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a route whose completed handoffs show a mailbox residence below the global warn and above min-warn-ms$/,
    (ctx) => {
      // ~3 minutes: above the 60s gate, below the 15m global warn, inside
      // the 4x adaptation ceiling.
      ctx.residenceSeconds = 180;
    },
    FEATURE
  );

  registry.defineScoped(
    /^that route has at least the minimum number of samples$/,
    (ctx) => {
      seedHistory(ctx, { count: 10, residenceSeconds: ctx.residenceSeconds });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the flow watchdog sweep runs over a parcel on that route$/,
    (ctx) => {
      // aged 10m: past the ~9m calibrated warn (p67 of the 180..720s spread),
      // short of the ~12m calibrated escalate and the 15m global warn
      writeLiveParcel(ctx, { ageSeconds: ctx.parcelAgeSeconds ?? 600 });
      ctx.alarms = runSweep(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the parcel is measured against the calibrated warn for that route$/,
    (ctx) => {
      assert.equal(ctx.alarms.length, 1, `expected one alarm:\n${JSON.stringify(ctx.alarms)}`);
      assert.match(ctx.alarms[0], /via cleaner->architect\|git_handoff/);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it alarms before the global warn threshold would have fired$/,
    (ctx) => {
      // the parcel's age (~5m) is far below the 15m global warn - only the
      // calibrated threshold can have fired this alarm
      assert.ok(600 * 1000 < GLOBAL_WARN_MS);
      assert.match(ctx.alarms[0], /⚠️ WARN/);
    },
    FEATURE
  );

  // ── Scenario 02 (outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^a route with fewer completed handoffs than the minimum number of samples$/,
    (ctx) => {
      // 3 samples from "coder" - under the min of 8
      seedHistory(ctx, { from: 'coder', count: 3, residenceSeconds: 180 });
      ctx.parcelFrom = 'coder';
    },
    FEATURE
  );

  registry.defineScoped(
    /^the same recipient and type has enough samples to calibrate$/,
    (ctx) => {
      // 8 samples from a DIFFERENT sender to the same recipient+type: the
      // *->architect|git_handoff row calibrates even though coder->architect
      // cannot
      seedHistory(ctx, { from: 'cleaner', count: 8, residenceSeconds: 180 });
      ctx.expectedVia = /via \*->architect\|git_handoff/;
      ctx.parcelAgeSeconds = 540;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the global config pair has enough samples to calibrate$/,
    (ctx) => {
      // nothing else seeded: resolution falls all the way to the global pair
      ctx.expectedVia = /via global/;
      // must age past the GLOBAL warn for the alarm to exist at all
      ctx.parcelAgeSeconds = Math.floor(GLOBAL_WARN_MS / 1000) + 60;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the thresholds are resolved from (the same recipient and type|the global config pair)$/,
    (ctx) => {
      assert.equal(ctx.alarms.length, 1, `expected one alarm:\n${JSON.stringify(ctx.alarms)}`);
      assert.match(ctx.alarms[0], ctx.expectedVia);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a parcel whose thresholds were resolved from a calibrated route$/,
    (ctx) => {
      ctx.resolved = bbEval(
        `(flow-watchdog-lib/resolve-thresholds
           {:from "cleaner" :to "architect" :type "git_handoff"}
           {"cleaner->architect|git_handoff" {:warn-ms 180000 :escalate-ms 360000}}
           {:warn-ms ${GLOBAL_WARN_MS} :escalate-ms ${GLOBAL_ESCALATE_MS}})`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the tier decision is made$/,
    (ctx) => {
      ctx.tierInputKeys = bbEval('flow-watchdog-lib/tier-decision-input-keys');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the decision input carries only an age and a threshold pair$/,
    (ctx) => {
      for (const key of [':age-ms', ':warn-ms', ':escalate-ms']) {
        assert.ok(ctx.tierInputKeys.includes(key), `${key} missing from ${ctx.tierInputKeys}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^it carries no from role, to role, type, or dormancy signal$/,
    (ctx) => {
      for (const forbidden of [':from', ':to', ':type', ':role', ':dormant', ':live']) {
        assert.ok(!ctx.tierInputKeys.includes(forbidden), `${forbidden} leaked into ${ctx.tierInputKeys}`);
      }
    },
    FEATURE
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a parcel that alarms on a calibrated route threshold$/,
    (ctx) => {
      seedHistory(ctx, { count: 10, residenceSeconds: 180 });
      writeLiveParcel(ctx, { id: 'calibrated-p', from: 'cleaner', ageSeconds: 600 });
    },
    FEATURE
  );

  registry.defineScoped(
    /^a second parcel that alarms on the global fallback pair$/,
    (ctx) => {
      // typed as a note: the cleaner history above calibrates the
      // git_handoff rows (exact AND *->architect|git_handoff), so only a
      // different TYPE has no calibrated row anywhere and resolves global
      writeHandoff(ctx.newDir, 'global-p', {
        id: 'global-p',
        from: 'stranger',
        to: 'architect',
        type: 'note',
        enqueued_at: new Date(NOW_MS - (GLOBAL_WARN_MS + 60000)).toISOString(),
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^each alarm is emitted$/,
    (ctx) => {
      ctx.alarms = runSweep(ctx);
      assert.equal(ctx.alarms.length, 2, `expected two alarms:\n${JSON.stringify(ctx.alarms)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^each alarm text names the threshold it used and where that threshold came from$/,
    (ctx) => {
      const calibrated = ctx.alarms.find((a) => a.includes('calibrated-p'));
      const global = ctx.alarms.find((a) => a.includes('global-p'));
      assert.ok(calibrated && global, `missing an expected alarm:\n${JSON.stringify(ctx.alarms)}`);
      assert.match(calibrated, /Threshold .+ via cleaner->architect\|git_handoff\./);
      assert.match(global, /Threshold .+ via global\./);
    },
    FEATURE
  );

  // ── Scenario 05 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a calibrated table written less than the recalibration interval ago$/,
    (ctx) => {
      fs.mkdirSync(ctx.daemonDir, { recursive: true });
      ctx.tablePath = path.join(ctx.daemonDir, 'flow-watchdog-thresholds.json');
      const table = { calibratedAt: NOW_MS - 60000, specs: { 'cleaner->architect|git_handoff': { 'warn-ms': 180000, 'escalate-ms': 360000, n: 10, source: 'exact' } } };
      fs.writeFileSync(ctx.tablePath, JSON.stringify(table));
      ctx.tableBefore = fs.readFileSync(ctx.tablePath, 'utf8');
      // audits on disk that WOULD change the table if re-read
      seedHistory(ctx, { count: 10, residenceSeconds: 600 });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the flow watchdog sweep runs$/,
    (ctx) => {
      ctx.alarms = runSweep(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the existing table is reused$/,
    (ctx) => {
      assert.equal(fs.readFileSync(ctx.tablePath, 'utf8'), ctx.tableBefore, 'table file must be untouched');
    },
    FEATURE
  );

  registry.defineScoped(
    /^no completed or abandoned audit is re-read$/,
    (ctx) => {
      // the audits seeded above would calibrate a DIFFERENT (600s) table -
      // the byte-identical file above proves they were never consulted
      assert.equal(fs.readFileSync(ctx.tablePath, 'utf8'), ctx.tableBefore);
    },
    FEATURE
  );

  // ── Scenario 06 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a calibrated table that is stale$/,
    (ctx) => {
      fs.mkdirSync(ctx.daemonDir, { recursive: true });
      ctx.tablePath = path.join(ctx.daemonDir, 'flow-watchdog-thresholds.json');
      const table = { calibratedAt: NOW_MS - 7 * 60 * 60 * 1000, specs: { 'cleaner->architect|git_handoff': { 'warn-ms': 180000, 'escalate-ms': 360000, n: 10, source: 'exact' } } };
      fs.writeFileSync(ctx.tablePath, JSON.stringify(table));
      ctx.tableBefore = fs.readFileSync(ctx.tablePath, 'utf8');
    },
    FEATURE
  );

  registry.defineScoped(
    /^recalibration fails$/,
    (ctx) => {
      // runSweep injects a throwing collector through the sweep's own
      // adapter seam (postFn convention, never chmod); the
      // parcel is written NOW so the same sweep can prove it still alarms
      ctx.calibBreak = true;
      writeLiveParcel(ctx, { ageSeconds: 600 });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the previous table stays in place$/,
    (ctx) => {
      assert.equal(fs.readFileSync(ctx.tablePath, 'utf8'), ctx.tableBefore, 'the durable table must be untouched');
    },
    FEATURE
  );

  registry.defineScoped(
    /^every parcel is still evaluated and still able to alarm$/,
    (ctx) => {
      assert.equal(ctx.alarms.length, 1, `expected the parcel to still alarm:\n${JSON.stringify(ctx.alarms)}`);
      assert.match(ctx.alarms[0], /via cleaner->architect\|git_handoff/);
    },
    FEATURE
  );

  // ── Scenario 07 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a sample set in which every recorded residence is identical$/,
    (ctx) => {
      ctx.flatSamplesExpr = '(repeat 10 180000)';
    },
    FEATURE
  );

  registry.defineScoped(
    /^its thresholds are calibrated$/,
    (ctx) => {
      ctx.calibrated = bbEvalJson(`(flow-watchdog-lib/thresholds-from-samples ${ctx.flatSamplesExpr})`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the escalate threshold is strictly above the warn threshold$/,
    (ctx) => {
      assert.ok(
        ctx.calibrated['escalate-ms'] > ctx.calibrated['warn-ms'],
        `expected strict ordering, got ${JSON.stringify(ctx.calibrated)}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
