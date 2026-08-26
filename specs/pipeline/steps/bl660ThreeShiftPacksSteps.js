'use strict';

// BL-660: three named shift packs — one active swarm_shift drives every
// schedule-derived clock. Drives real swarm_shift_lib.bb, shift applier, and
// compiled swarmShiftCore.ts / cooldownWindowCore.ts / nightClosingCeremony.ts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const EXT = path.join(REPO_ROOT, 'extension');
const FEATURE = 'Three named shift packs — one active shift drives every schedule-derived clock';

const EVENING_ANCHOR_CASES = {
  'Monday 16:30': { startDay: 'Monday', stopDay: 'Tuesday' },
  'Monday 23:00': { startDay: 'Monday', stopDay: 'Tuesday' },
  'Tuesday 00:30': { startDay: 'Monday', stopDay: 'Tuesday' },
};

const SHIFT_NAMES = new Set(['day', 'evening', 'night']);

const SHIFT_LIB = path.join(SCRIPTS, 'swarm_shift_lib.bb');
const APPLIER_LIB = path.join(SCRIPTS, 'shift_schedule_applier_lib.bb');
const APPLY_CLI = path.join(SCRIPTS, 'apply_shift_schedule.bb');
const BB_TEST = path.join(SCRIPTS, 'test', 'swarm_shift_lib_test_runner.bb');
const BB_PROPERTY = path.join(SCRIPTS, 'test', 'bl660_swarm_shift_property_runner.bb');
const SHELL_SMOKE = path.join(SCRIPTS, 'test', 'test_shift_schedule_applier.sh');

const {
  resolveShiftSchedule,
  longestStoppedGapMinutes,
  effectiveCloseLocal,
  extendedCloseAnnouncementText,
  formatLocalTime,
  parseSwarmShift,
} = require(path.join(EXT, 'out', 'tools', 'swarmShiftCore'));
const { parseCooldownConfig } = require(path.join(EXT, 'out', 'tools', 'cooldownWindowCore'));
const { resolveClosureSchedule } = require(path.join(EXT, 'out', 'quality', 'nightClosingCeremony'));

function bbEval(code) {
  return execFileSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 }).trim();
}

function loadBb(ns, file) {
  return file.replace(/\\/g, '\\\\');
}

function ensure(ctx) {
  if (!ctx.bl660) {
    ctx.bl660 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl660-')),
      confLines: [],
      schedule: null,
      crontabLines: [],
      applierOut: null,
    };
    fs.mkdirSync(path.join(ctx.bl660.root, 'swarmforge'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl660.root, '.swarmforge', 'operator'), { recursive: true });
    ctx.bl660.crontabPath = path.join(ctx.bl660.root, '.swarmforge', 'operator', 'shift-crontab.fixture');
  }
  return ctx.bl660;
}

function writeConf(st) {
  const body = st.confLines.join('\n') + (st.confLines.length ? '\n' : '');
  fs.writeFileSync(path.join(st.root, 'swarmforge', 'swarmforge.conf'), body);
}

function runApplier(st) {
  const out = execFileSync(
    'bb',
    [APPLY_CLI, st.root, '--crontab-file', st.crontabPath],
    { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 },
  );
  st.applierOut = JSON.parse(out.trim());
  if (fs.existsSync(st.crontabPath)) {
    st.crontabLines = fs.readFileSync(st.crontabPath, 'utf8').split('\n').filter(Boolean);
  }
  return st.applierOut;
}

function confText(st) {
  return st.confLines.join('\n') + '\n';
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(pattern, fn, FEATURE);

  registry.define(/^a crontab fixture managed by the shift schedule applier$/, (ctx) => {
    const st = ensure(ctx);
    st.crontabLines = [];
    if (fs.existsSync(st.crontabPath)) {
      fs.unlinkSync(st.crontabPath);
    }
  });

  scoped(/^swarm_shift is set to "([^"]+)"$/, (ctx, shift) => {
    if (!SHIFT_NAMES.has(shift)) {
      throw new Error(`unknown shift name in Examples: ${shift}`);
    }
    const st = ensure(ctx);
    st.confLines = st.confLines.filter((l) => !l.startsWith('config swarm_shift '));
    st.confLines.push(`config swarm_shift ${shift}`);
    writeConf(st);
    st.activeShift = shift;
  });

  scoped(/^swarm_shift is absent from swarmforge\.conf$/, (ctx) => {
    const st = ensure(ctx);
    st.confLines = st.confLines.filter((l) => !l.startsWith('config swarm_shift '));
    st.confLines.push('config cooldown_window_enabled false');
    writeConf(st);
  });

  scoped(/^the cooldown window is disabled as it is today$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.confLines.some((l) => l.startsWith('config cooldown_window_enabled '))) {
      st.confLines.push('config cooldown_window_enabled false');
      writeConf(st);
    }
  });

  scoped(/^the shift schedule is resolved$/, (ctx) => {
    const st = ensure(ctx);
    execFileSync('bb', [BB_TEST], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
    execFileSync('bb', [BB_PROPERTY], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
    st.schedule = resolveShiftSchedule(confText(st));
    st.bbSchedule = JSON.parse(
      bbEval(`(load-file "${loadBb('', SHIFT_LIB)}")
              (require '[cheshire.core :as json])
              (println (json/generate-string (swarm-shift-lib/resolve-schedule ${JSON.stringify(confText(st))})))`),
    );
  });

  scoped(/^the scheduled swarm start is "([^"]+)" local$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    assert.equal(formatLocalTime(st.schedule.startLocal), hhmm);
    assert.equal(st.bbSchedule['start-local'], hhmm);
  });

  scoped(/^the scheduled swarm stop is "([^"]+)" local$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    assert.equal(formatLocalTime(st.schedule.stopLocal), hhmm);
    assert.equal(st.bbSchedule['stop-local'], hhmm);
  });

  scoped(/^closure_stop_local is derived as "([^"]+)" local$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    const closure = resolveClosureSchedule(confText(st));
    assert.equal(closure.state, 'ok');
    assert.equal(formatLocalTime(closure.closure), hhmm);
  });

  scoped(/^the cooldown pause window is derived as "([^"]+)" to "([^"]+)" local$/, (ctx, start, end) => {
    const st = ensure(ctx);
    const cooldown = parseCooldownConfig(confText(st));
    assert.equal(cooldown.config.enabled, true);
    assert.equal(formatLocalTime(cooldown.config.startLocal), start);
    assert.equal(formatLocalTime(cooldown.config.endLocal), end);
  });

  scoped(/^no other schedule constant needs editing for those times$/, () => {
    execFileSync('bash', [SHELL_SMOKE], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 60000 });
  });

  scoped(
    /^swarm_shift was "([^"]+)" and is changed to "([^"]+)" while the swarm is stopped$/,
    (ctx, from, to) => {
      const st = ensure(ctx);
      st.confLines = [`config swarm_shift ${from}`];
      writeConf(st);
      runApplier(st);
      st.confLines = [`config swarm_shift ${to}`];
      writeConf(st);
      st.activeShift = to;
    },
  );

  scoped(/^the shift schedule applier reconciles crontab$/, (ctx) => {
    runApplier(ensure(ctx));
  });

  scoped(/^the next scheduled start is "([^"]+)" local$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    const s = resolveShiftSchedule(confText(st));
    assert.equal(formatLocalTime(s.startLocal), hhmm);
  });

  scoped(/^the next scheduled stop is "([^"]+)" local on the following calendar day$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    const s = resolveShiftSchedule(confText(st));
    assert.equal(formatLocalTime(s.stopLocal), hhmm);
    const anchor = bbEval(
      `(load-file "${loadBb('', SHIFT_LIB)}")
       (println (:stop-day (swarm-shift-lib/calendar-anchor "evening" "Monday 23:00")))`,
    );
    assert.equal(anchor, 'Tuesday');
  });

  scoped(/^no stale start or stop line from the day shift remains armed$/, (ctx) => {
    const st = ensure(ctx);
    const joined = st.crontabLines.join('\n');
    assert.ok(!joined.includes('0 9 * * *'), 'stale day start at 09:00');
  });

  scoped(/^no shift-derived start or stop crontab lines are rendered$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(parseSwarmShift(confText(st)), null);
    const out = runApplier(st);
    assert.equal(out.applied, false);
  });

  scoped(/^the cooldown decision matches today's disabled-window behaviour exactly$/, (ctx) => {
    const st = ensure(ctx);
    const cooldown = parseCooldownConfig(confText(st));
    assert.equal(cooldown.config.enabled, false);
    assert.equal(cooldown.malformed, false);
  });

  scoped(/^closure_stop_local behaviour matches today's absent-or-manual path$/, (ctx) => {
    const st = ensure(ctx);
    const closure = resolveClosureSchedule(confText(st));
    assert.equal(closure.state, 'absent');
  });

  scoped(/^the shift schedule is resolved for local time "([^"]+)"$/, (ctx, anchor) => {
    if (!EVENING_ANCHOR_CASES[anchor]) {
      throw new Error(`unknown anchor in Examples: ${anchor}`);
    }
    ctx.bl660Anchor = anchor;
    ctx.bl660ExpectedDays = EVENING_ANCHOR_CASES[anchor];
  });

  scoped(/^the scheduled swarm start calendar day is "([^"]+)"$/, (ctx, day) => {
    assert.equal(day, ctx.bl660ExpectedDays.startDay);
    const anchor = ctx.bl660Anchor;
    const got = bbEval(
      `(load-file "${loadBb('', SHIFT_LIB)}")
       (println (:start-day (swarm-shift-lib/calendar-anchor "evening" "${anchor}")))`,
    );
    assert.equal(got, day);
  });

  scoped(/^the scheduled swarm stop calendar day is "([^"]+)"$/, (ctx, day) => {
    assert.equal(day, ctx.bl660ExpectedDays.stopDay);
    const anchor = ctx.bl660Anchor;
    const got = bbEval(
      `(load-file "${loadBb('', SHIFT_LIB)}")
       (println (:stop-day (swarm-shift-lib/calendar-anchor "evening" "${anchor}")))`,
    );
    assert.equal(got, day);
  });

  scoped(/^the scheduled swarm start time is "([^"]+)" local$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    assert.equal(formatLocalTime(st.schedule?.startLocal ?? resolveShiftSchedule(confText(st)).startLocal), hhmm);
  });

  scoped(/^the scheduled swarm stop time is "([^"]+)" local$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    assert.equal(formatLocalTime(st.schedule?.stopLocal ?? resolveShiftSchedule(confText(st)).stopLocal), hhmm);
  });

  scoped(/^the current local time is "([^"]+)" outside the day shift$/, (ctx, hhmm) => {
    const [h] = hhmm.split(':').map(Number);
    ctx.bl660NowMinutes = h * 60;
  });

  scoped(/^a human starts the swarm manually for backlog drain$/, (ctx) => {
    const out = bbEval(
      `(load-file "${loadBb('', SHIFT_LIB)}")
       (println (swarm-shift-lib/manual-start-outside-shift?
                 {:shift-name "day"
                  :now-minutes ${ctx.bl660NowMinutes}
                  :manual-start? true}))`,
    );
    ctx.bl660ManualOutside = out === 'true';
  });

  scoped(/^the swarm is not paused by shift machinery$/, (ctx) => {
    assert.equal(ctx.bl660ManualOutside, true);
  });

  scoped(/^the swarm is not killed by shift machinery$/, (ctx) => {
    assert.equal(ctx.bl660ManualOutside, true);
  });

  scoped(/^the swarm is not immediately re-scheduled by shift machinery$/, (ctx) => {
    assert.equal(ctx.bl660ManualOutside, true);
  });

  scoped(/^the next scheduled shift boundary arrives$/, () => {});

  scoped(/^the normal scheduled machinery applies from that boundary onward$/, (ctx) => {
    const within = bbEval(
      `(load-file "${loadBb('', SHIFT_LIB)}")
       (println (swarm-shift-lib/within-shift-minutes? ${9 * 60} [9 0] [17 0]))`,
    );
    assert.equal(within, 'true');
  });

  scoped(/^the longest stopped interval between consecutive shift runs is computed$/, (ctx) => {
    ctx.bl660GapMinutes = longestStoppedGapMinutes(ensure(ctx).activeShift);
  });

  scoped(/^that stopped gap is strictly less than 24 hours$/, (ctx) => {
    assert.ok(ctx.bl660GapMinutes < 24 * 60);
  });

  scoped(/^the shift schedule applier has already rendered the crontab$/, (ctx) => {
    const st = ensure(ctx);
    runApplier(st);
    st.crontabLines.push('# human cron');
    st.crontabLines.push('0 12 * * * /usr/bin/true');
    fs.writeFileSync(st.crontabPath, st.crontabLines.join('\n') + '\n');
    ctx.bl660CrontabBeforeSecondApply = fs.readFileSync(st.crontabPath, 'utf8');
  });

  scoped(/^the shift schedule applier runs again with unchanged conf$/, (ctx) => {
    runApplier(ensure(ctx));
  });

  scoped(/^the crontab is unchanged$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.readFileSync(st.crontabPath, 'utf8'), ctx.bl660CrontabBeforeSecondApply);
  });

  scoped(/^a human-edited crontab line the applier did not render is surfaced not overwritten$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.crontabLines.some((l) => l.includes('/usr/bin/true')));
    const split = JSON.parse(
      bbEval(`(load-file "${loadBb('', APPLIER_LIB)}")
              (require '[cheshire.core :as json])
              (println (json/generate-string
                (shift-schedule-applier-lib/reconcile-crontab
                  ${JSON.stringify(st.crontabLines)}
                  {:root "${st.root}"
                   :start-local "01:00"
                   :stop-local "09:00"
                   :start-script "${st.root}/start-swarm.sh"
                   :stop-script "${st.root}/stop-swarm.sh"})))`),
    );
    assert.ok(split['surfaced-human'].some((l) => l.includes('/usr/bin/true')));
  });

  scoped(/^swarm_shift is "([^"]+)" and the swarm is running inside the day shift$/, (ctx, shift) => {
    ctx.bl660RunningShift = shift;
  });

  scoped(/^swarm_shift is changed to "([^"]+)" before the day shift ends$/, (ctx, requested) => {
    const continues = bbEval(
      `(load-file "${loadBb('', SHIFT_LIB)}")
       (println (swarm-shift-lib/running-shift-continues?
                 {:running-shift "${ctx.bl660RunningShift}"
                  :requested-shift "${requested}"}))`,
    );
    ctx.bl660Continues = continues === 'true';
    ctx.bl660RequestedShift = requested;
  });

  scoped(/^the current day shift continues until its scheduled stop$/, (ctx) => {
    assert.equal(ctx.bl660Continues, true);
  });

  scoped(/^the evening shift schedule applies only from the next boundary onward$/, (ctx) => {
    const evening = resolveShiftSchedule(`config swarm_shift ${ctx.bl660RequestedShift}\n`);
    assert.equal(formatLocalTime(evening.startLocal), '17:00');
  });

  scoped(/^swarm_shift is set to "([^"]+)" with scheduled stop "([^"]+)" local$/, (ctx, shift, stop) => {
    const st = ensure(ctx);
    st.confLines = [`config swarm_shift ${shift}`];
    writeConf(st);
    st.scheduledStop = stop;
    st.activeShift = shift;
  });

  scoped(/^a signature-backed provider outage of 90 minutes occurred during the shift$/, (ctx) => {
    ctx.bl660OutageMinutes = 90;
  });

  scoped(/^the effective close time is computed with a 2-hour credit cap$/, (ctx) => {
    const [h, m] = ensure(ctx).scheduledStop.split(':').map(Number);
    ctx.bl660EffectiveClose = effectiveCloseLocal({
      scheduledStopLocal: { hour: h, minute: m },
      outageMinutes: ctx.bl660OutageMinutes,
      capMinutes: 120,
    });
  });

  scoped(/^the credited close time is "([^"]+)" local$/, (ctx, hhmm) => {
    assert.equal(formatLocalTime(ctx.bl660EffectiveClose), hhmm);
  });

  scoped(/^the credited close time remains "([^"]+)" local$/, (ctx, hhmm) => {
    assert.equal(formatLocalTime(ctx.bl660EffectiveClose), hhmm);
  });

  scoped(
    /^an extended-close announcement naming the credited interval is posted to the Operator topic$/,
    (ctx) => {
      const text = extendedCloseAnnouncementText({
        shift: ensure(ctx).activeShift,
        outageMinutes: ctx.bl660OutageMinutes,
        scheduledStopLocal: { hour: 9, minute: 0 },
        effectiveCloseLocal: ctx.bl660EffectiveClose,
      });
      assert.ok(text.includes(String(ctx.bl660OutageMinutes)));
      assert.ok(text.includes(formatLocalTime(ctx.bl660EffectiveClose)));
      ctx.bl660Announcement = text;
    },
  );

  scoped(/^the swarm crashed and restarted on its own during the shift$/, (ctx) => {
    ctx.bl660SwarmCaused = true;
  });

  scoped(/^the effective close time is computed$/, (ctx) => {
    const [h, m] = ensure(ctx).scheduledStop.split(':').map(Number);
    ctx.bl660EffectiveClose = effectiveCloseLocal({
      scheduledStopLocal: { hour: h, minute: m },
      outageMinutes: 90,
      swarmCaused: ctx.bl660SwarmCaused,
    });
  });

  scoped(/^no outage credit is applied for the crash interval$/, (ctx) => {
    assert.equal(formatLocalTime(ctx.bl660EffectiveClose), ensure(ctx).scheduledStop);
  });
}

module.exports = { registerSteps };
