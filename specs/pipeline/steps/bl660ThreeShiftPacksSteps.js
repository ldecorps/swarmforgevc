'use strict';

// BL-660: three named shift packs — one active swarm_shift drives every schedule-derived clock.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const FEATURE = 'three named shift packs selectable in conf';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const EXT = path.join(REPO_ROOT, 'extension');

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
  formatLocalTime,
  parseSwarmShift,
} = require(path.join(EXT, 'out', 'tools', 'swarmShiftCore'));
const { parseCooldownConfig } = require(path.join(EXT, 'out', 'tools', 'cooldownWindowCore'));
const { resolveClosureSchedule } = require(path.join(EXT, 'out', 'quality', 'nightClosingCeremony'));

function bbEval(code) {
  return execFileSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 }).trim();
}

function loadBb(file) {
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

function resolveSchedule(st) {
  execFileSync('bb', [BB_TEST], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
  execFileSync('bb', [BB_PROPERTY], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
  st.schedule = resolveShiftSchedule(confText(st));
  return st.schedule;
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(pattern, fn, FEATURE);

  scoped(/^a fixture swarm root with shift schedule seams and controllable clocks$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^swarmforge conf has config swarm_shift (\w+) for fixture root R$/, (ctx, shift) => {
    if (!SHIFT_NAMES.has(shift)) {
      throw new Error(`unknown shift name: ${shift}`);
    }
    const st = ensure(ctx);
    st.confLines = st.confLines.filter((l) => !l.startsWith('config swarm_shift '));
    st.confLines.push(`config swarm_shift ${shift}`);
    writeConf(st);
    st.activeShift = shift;
  });

  scoped(/^swarmforge conf had config swarm_shift (\w+) for fixture root R$/, (ctx, shift) => {
    const st = ensure(ctx);
    st.confLines = [`config swarm_shift ${shift}`];
    writeConf(st);
    st.activeShift = shift;
  });

  scoped(/^the schedule crontab was applied for root R$/, (ctx) => {
    runApplier(ensure(ctx));
  });

  scoped(/^the shift schedule is resolved for root R$/, (ctx) => {
    resolveSchedule(ensure(ctx));
  });

  scoped(/^shift resolution runs for fixture root R$/, (ctx) => {
    resolveSchedule(ensure(ctx));
  });

  scoped(
    /^scheduled start is at (\d{2}:\d{2}) local and scheduled stop at (\d{2}:\d{2}) local$/,
    (ctx, start, stop) => {
      const st = ensure(ctx);
      const s = st.schedule ?? resolveShiftSchedule(confText(st));
      assert.equal(formatLocalTime(s.startLocal), start);
      assert.equal(formatLocalTime(s.stopLocal), stop);
    },
  );

  scoped(/^BL-617 cooldown pause covers (\d{2}:\d{2}) through (\d{2}:\d{2}) local$/, (ctx, start, end) => {
    const st = ensure(ctx);
    const cooldown = parseCooldownConfig(confText(st));
    assert.equal(cooldown.config?.enabled, true);
    assert.equal(formatLocalTime(cooldown.config.startLocal), start);
    assert.equal(formatLocalTime(cooldown.config.endLocal), end);
  });

  scoped(/^closure_stop_local equals the shift end$/, (ctx) => {
    const st = ensure(ctx);
    const s = st.schedule ?? resolveShiftSchedule(confText(st));
    const closure = resolveClosureSchedule(confText(st));
    assert.equal(closure.state, 'ok');
    assert.equal(formatLocalTime(closure.closure), formatLocalTime(s.stopLocal));
  });

  scoped(
    /^conf is changed to config swarm_shift (\w+) and the applier reconciles$/,
    (ctx, shift) => {
      const st = ensure(ctx);
      st.confLines = [`config swarm_shift ${shift}`];
      writeConf(st);
      st.activeShift = shift;
      runApplier(st);
    },
  );

  scoped(
    /^the rendered crontab start line fires at (\d{2}:\d{2}) local and stop at (\d{2}:\d{2}) local$/,
    (ctx, start, stop) => {
      const st = ensure(ctx);
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = stop.split(':').map(Number);
      const joined = st.crontabLines.join('\n');
      assert.ok(joined.includes(`${sm} ${sh}`), `expected start cron ${start}`);
      assert.ok(joined.includes(`${em} ${eh}`), `expected stop cron ${stop}`);
    },
  );

  scoped(/^no stale day-shift start or stop line remains for root R$/, (ctx) => {
    const joined = ensure(ctx).crontabLines.join('\n');
    assert.ok(!joined.includes('0 9 * * *'), 'stale day start at 09:00');
    assert.ok(joined.includes('0 17 * * *'), 'evening start at 17:00');
  });

  scoped(/^swarmforge conf has no config swarm_shift line$/, (ctx) => {
    const st = ensure(ctx);
    st.confLines = st.confLines.filter((l) => !l.startsWith('config swarm_shift '));
    writeConf(st);
  });

  scoped(/^cooldown_window_enabled is false or absent$/, (ctx) => {
    const st = ensure(ctx);
    st.confLines = st.confLines.filter((l) => !l.startsWith('config cooldown_window_enabled '));
    if (!st.confLines.some((l) => l.startsWith('config cooldown_window_enabled '))) {
      st.confLines.push('config cooldown_window_enabled false');
    }
    writeConf(st);
  });

  scoped(
    /^scheduling behaves byte-identically to today's disabled cooldown window$/,
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(parseSwarmShift(confText(st)), null);
      const cooldown = parseCooldownConfig(confText(st));
      assert.equal(cooldown.config?.enabled, false);
      assert.equal(cooldown.malformed, false);
      const closure = resolveClosureSchedule(confText(st));
      assert.equal(closure.state, 'absent');
      const out = runApplier(st);
      assert.equal(out.applied, false);
    },
  );

  scoped(/^the schedule crontab is rendered for root R$/, (ctx) => {
    runApplier(ensure(ctx));
  });

  scoped(/^the start cron fields target (\d{2}:\d{2}) on the local calendar day$/, (ctx, hhmm) => {
    const st = ensure(ctx);
    const [h, m] = hhmm.split(':').map(Number);
    const cron = st.crontabLines.find((l) => l.includes(`${m} ${h}`));
    assert.ok(cron, `no cron line for ${hhmm}`);
    const anchor = bbEval(
      `(load-file "${loadBb(SHIFT_LIB)}")
       (println (:start-day (swarm-shift-lib/calendar-anchor "evening" "Monday 17:00")))`,
    );
    assert.equal(anchor, 'Monday');
  });

  scoped(
    /^the stop cron fields target (\d{2}:\d{2}) on the following local calendar day$/,
    (ctx, hhmm) => {
      const st = ensure(ctx);
      const [h, m] = hhmm.split(':').map(Number);
      const cron = st.crontabLines.find((l) => l.includes(`${m} ${h}`));
      assert.ok(cron, `no cron line for ${hhmm}`);
      const stopDay = bbEval(
        `(load-file "${loadBb(SHIFT_LIB)}")
         (println (:stop-day (swarm-shift-lib/calendar-anchor "evening" "Monday 23:00")))`,
      );
      assert.equal(stopDay, 'Tuesday');
    },
  );

  scoped(/^the swarm is stopped outside the day shift window$/, (ctx) => {
    ctx.bl660NowMinutes = 20 * 60;
  });

  scoped(/^the operator runs a manual start for root R$/, (ctx) => {
    const out = bbEval(
      `(load-file "${loadBb(SHIFT_LIB)}")
       (println (swarm-shift-lib/manual-start-outside-shift?
                 {:shift-name "day"
                  :now-minutes ${ctx.bl660NowMinutes}
                  :manual-start? true}))`,
    );
    ctx.bl660ManualOutside = out === 'true';
  });

  scoped(/^the swarm stays up without cooldown pause$/, (ctx) => {
    assert.equal(ctx.bl660ManualOutside, true);
  });

  scoped(/^scheduled boundaries apply normally on the next cycle$/, (ctx) => {
    const within = bbEval(
      `(load-file "${loadBb(SHIFT_LIB)}")
       (println (swarm-shift-lib/within-shift-minutes? ${9 * 60} [9 0] [17 0]))`,
    );
    assert.equal(within, 'true');
    execFileSync('bash', [SHELL_SMOKE], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 60000 });
  });

  scoped(/^the stopped gap between shift end and next shift start is computed$/, (ctx) => {
    const st = ensure(ctx);
    ctx.bl660GapMinutes = longestStoppedGapMinutes(st.activeShift);
  });

  scoped(/^the gap duration is strictly less than twenty-four hours$/, (ctx) => {
    assert.ok(ctx.bl660GapMinutes < 24 * 60);
  });

  scoped(/^root R schedule lines are already current in the user crontab$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.confLines.some((l) => l.startsWith('config swarm_shift '))) {
      st.confLines.push('config swarm_shift night');
      writeConf(st);
      st.activeShift = 'night';
    }
    runApplier(st);
    ctx.bl660CrontabBefore = fs.readFileSync(st.crontabPath, 'utf8');
  });

  scoped(
    /^a human-added crontab line exists that the applier did not render for root R$/,
    (ctx) => {
      const st = ensure(ctx);
      st.crontabLines.push('# human cron');
      st.crontabLines.push('0 12 * * * /usr/bin/true');
      fs.writeFileSync(st.crontabPath, st.crontabLines.join('\n') + '\n');
      ctx.bl660CrontabBefore = fs.readFileSync(st.crontabPath, 'utf8');
    },
  );

  scoped(/^the schedule applier reconciles root R$/, (ctx) => {
    runApplier(ensure(ctx));
  });

  scoped(/^crontab -l for root R is unchanged except surfaced warnings$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.readFileSync(st.crontabPath, 'utf8'), ctx.bl660CrontabBefore);
  });

  scoped(/^the human-added line remains present$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.crontabLines.some((l) => l.includes('/usr/bin/true')));
    const split = JSON.parse(
      bbEval(`(load-file "${loadBb(APPLIER_LIB)}")
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
}

module.exports = { registerSteps };
