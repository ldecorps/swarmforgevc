'use strict';

// BL-779: step handlers for "pause-blind flow-watchdog alarm names control pause".
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FLOW_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'flow_watchdog_lib.bb');
const SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitterd_sweep_lib.bb');
const FEATURE = 'pause-blind flow-watchdog alarm names control pause';

const WARN_MS = 900000;
const ESCALATE_MS = 3600000;
const AGE_MS = 1800000;
const TIMED_UNTIL_MS = Date.parse('2026-08-02T08:00:00Z');

const BASE_ALARM = {
  id: 'p',
  from: 'hardener',
  to: 'documenter',
  type: 'git_handoff',
  ageMs: AGE_MS,
  role: 'documenter',
  mailbox: 'new',
  verb: 'rotate',
  tier: 'warn',
};

function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`unsupported clj value: ${v}`);
}

function bbRun(code) {
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed:\n${code}\n${result.stderr}`);
  }
  const lines = result.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

function formatAlarmText(ctx) {
  const s = ctx.bl779;
  const code = `
(load-file "${FLOW_LIB}")
(def text (flow-watchdog-lib/format-alarm-text
           {:id ${cljVal(s.id)} :from ${cljVal(s.from)} :to ${cljVal(s.to)}
            :type ${cljVal(s.type)} :age-ms ${s.ageMs} :role ${cljVal(s.role)}
            :mailbox ${cljVal(s.mailbox)} :verb ${cljVal(s.verb)} :tier ${cljVal(s.tier)}
            :pause-active? ${cljVal(s.pauseActive)} :pause-until-ms ${cljVal(s.pauseUntilMs)}}))
(println (cheshire.core/generate-string {:text text}))`;
  return bbRun(code).text;
}

function registerSteps(registry) {
  registry.defineScoped(/^a parcel aged past the warn threshold$/, (ctx) => {
    ctx.bl779 = { ...BASE_ALARM };
  }, FEATURE);

  registry.defineScoped(/^a control pause is active with a timed untilMs$/, (ctx) => {
    ctx.bl779.pauseActive = true;
    ctx.bl779.pauseUntilMs = TIMED_UNTIL_MS;
  }, FEATURE);

  registry.defineScoped(/^no control pause is active$/, (ctx) => {
    ctx.bl779.pauseActive = false;
    ctx.bl779.pauseUntilMs = null;
  }, FEATURE);

  registry.defineScoped(/^a control pause is active until operator resumes$/, (ctx) => {
    ctx.bl779.pauseActive = true;
    ctx.bl779.pauseUntilMs = null;
  }, FEATURE);

  registry.defineScoped(/^a control pause is active$/, (ctx) => {
    ctx.bl779.pauseActive = true;
    ctx.bl779.pauseUntilMs = TIMED_UNTIL_MS;
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog formats the alarm text$/, (ctx) => {
    ctx.bl779.alarmText = formatAlarmText(ctx);
  }, FEATURE);

  registry.defineScoped(/^the alarm names the pause and its end time$/, (ctx) => {
    const text = ctx.bl779.alarmText;
    if (!text.includes('(swarm paused)')) {
      throw new Error(`expected swarm paused marker in alarm: ${text}`);
    }
    if (!text.includes('paused until 2026-08-02T08:00:00Z')) {
      throw new Error(`expected timed pause end in alarm: ${text}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm carries no rotate or nudge verb$/, (ctx) => {
    const text = ctx.bl779.alarmText;
    if (text.includes('rotate') || text.includes('nudge')) {
      throw new Error(`alarm must not prescribe rotate/nudge during pause: ${text}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm text includes the prescribed unblock verb$/, (ctx) => {
    const text = ctx.bl779.alarmText;
    if (!text.endsWith('rotate.')) {
      throw new Error(`expected rotate verb in alarm: ${text}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm says paused until operator resumes$/, (ctx) => {
    const text = ctx.bl779.alarmText;
    if (!text.includes('paused until operator resumes')) {
      throw new Error(`expected operator-resume pause wording: ${text}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the alarm does not fabricate a timed end$/, (ctx) => {
    const text = ctx.bl779.alarmText;
    if (/paused until 20\d{2}/.test(text)) {
      throw new Error(`alarm fabricated a timed end: ${text}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the flow watchdog evaluates the parcel tier$/, (ctx) => {
    const code = `
(load-file "${FLOW_LIB}")
(def tier (flow-watchdog-lib/evaluate-parcel-tier ${AGE_MS} ${WARN_MS} ${ESCALATE_MS} {} "p" false))
(println (cheshire.core/generate-string {:tier (name tier)}))`;
    ctx.bl779.tierResult = bbRun(code).tier;
  }, FEATURE);

  registry.defineScoped(/^a warn tier is still decided$/, (ctx) => {
    if (ctx.bl779.tierResult !== 'warn') {
      throw new Error(`expected warn tier during pause, got ${ctx.bl779.tierResult}`);
    }
  }, FEATURE);

  registry.defineScoped(/^a green babysitter snapshot$/, (ctx) => {
    ctx.bl779 = { babysitter: true };
  }, FEATURE);

  registry.defineScoped(/^the babysitter formats the all-clear line$/, (ctx) => {
    const code = `
(load-file "${SWEEP_LIB}")
(def line (babysitterd-sweep-lib/format-all-clear-line {:pause-active? true :pause-until-ms ${TIMED_UNTIL_MS}}))
(println (cheshire.core/generate-string {:line line}))`;
    ctx.bl779.allClearLine = bbRun(code).line;
  }, FEATURE);

  registry.defineScoped(/^the line names the control pause and its end time$/, (ctx) => {
    const line = ctx.bl779.allClearLine;
    if (!line.includes('control pause active until 2026-08-02T08:00:00Z')) {
      throw new Error(`expected pause-named all-clear line: ${line}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
