'use strict';

// BL-823: step handlers for "Append-only swarm availability interval
// ledger". Drives the REAL compiled write side (telegram-front-desk-bot.js's
// writeControlPauseState / telegramCursorOperatorExec.js's
// writeOperatorPauseState, both wrapping availabilityLedgerStore.js's
// appendAvailabilityRecord), the REAL shell write side
// (availability_ledger_lib.sh's availability_record /
// availability_close_ungraceful_stop, via a small acceptance-runner shell
// script under swarmforge/scripts/test/ - the same "dedicated runner, never
// a reimplementation" posture as BL-551's own bb-fixture runners), and the
// REAL Babashka reader (availability_ledger_lib.bb's fold, via a small
// acceptance-runner bb script) - never a hand-rolled reimplementation of
// any of these (engineering.prompt's APS rule).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const SCRIPTS_TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const { writeControlPauseState, readControlPauseState } = require(path.join(EXT_OUT, 'tools', 'telegram-front-desk-bot'));
const { writeOperatorPauseState } = require(path.join(EXT_OUT, 'tools', 'telegramCursorOperatorExec'));
const { availabilityLedgerFileForMonth } = require(path.join(EXT_OUT, 'metrics', 'availabilityLedgerStore'));

const FOLD_RUNNER = path.join(SCRIPTS_TEST_DIR, 'bl823_fold_acceptance_runner.bb');
const SHELL_WRITER_RUNNER = path.join(SCRIPTS_TEST_DIR, 'bl823_shell_writer_acceptance_runner.sh');

// BL-425 scoping convention: every registration below is pinned to this
// exact Feature: title.
const FEATURE = 'Append-only swarm availability interval ledger';

// engineering.prompt Scenario Outline rule: Examples values are validated
// against an explicit lookup, never a bare passthrough.
const KNOWN_WRITERS = new Set(['control', 'operator']);
const KNOWN_ACTIVE = new Set(['true', 'false']);
const KNOWN_EVENTS = new Set(['stop', 'start', 'pause-start', 'pause-end']);
const KNOWN_OPERATIONS = new Set(['control pause', 'swarm stop', 'swarm start']);

const EVENT_TO_CLASS = {
  stop: 'swarm-stop',
  start: 'swarm-stop',
  'pause-start': 'control-pause',
  'pause-end': 'control-pause',
};

const EVENT_TO_SOURCE = {
  stop: 'kill_pipeline_swarm.sh',
  start: 'start-swarm.sh',
  'pause-start': 'telegram-front-desk-bot:pause',
  'pause-end': 'telegram-front-desk-bot:resume',
};

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl823-acceptance-'));
}

function stateDirFor(root) {
  return path.join(root, '.swarmforge');
}

function ledgerFilePath(root, ts) {
  return availabilityLedgerFileForMonth(root, ts.slice(0, 7));
}

function appendRawLedgerLine(root, month, line) {
  const filePath = availabilityLedgerFileForMonth(root, month);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, line + '\n');
}

function readLastLedgerRecord(root) {
  const filePath = ledgerFilePath(root, new Date().toISOString());
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0);
  return JSON.parse(lines[lines.length - 1]);
}

function runFold(root) {
  const out = execFileSync('bb', [FOLD_RUNNER, stateDirFor(root)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function heartbeatFilePath(root) {
  return path.join(root, '.swarmforge', 'daemon', 'handoffd.heartbeat');
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(/^a project root whose availability ledger is empty$/, (ctx) => {
    ctx.root = mkRoot();
    ctx.lastMonth = null;
  }, FEATURE);

  // ── scenario 01 (Scenario Outline): writer twins ─────────────────────────
  registry.defineScoped(/^the (control|operator) pause writer sets active to (true|false)$/, (ctx, writer, activeStr) => {
    if (!KNOWN_WRITERS.has(writer)) {
      throw new Error(`unrecognized Examples <writer> value: "${writer}"`);
    }
    if (!KNOWN_ACTIVE.has(activeStr)) {
      throw new Error(`unrecognized Examples <active> value: "${activeStr}"`);
    }
    const active = activeStr === 'true';
    if (writer === 'control') {
      writeControlPauseState(ctx.root, active ? { active: true, untilMs: undefined } : { active: false }, 'acceptance-test:control');
    } else {
      writeOperatorPauseState(ctx.root, { active }, 'acceptance-test:operator');
    }
  }, FEATURE);

  registry.defineScoped(/^the ledger's last record has event "([^"]+)" and class "control-pause"$/, (ctx, event) => {
    if (!KNOWN_EVENTS.has(event)) {
      throw new Error(`unrecognized Examples <event> value: "${event}"`);
    }
    ctx.lastRecord = readLastLedgerRecord(ctx.root);
    if (ctx.lastRecord.event !== event) {
      throw new Error(`expected last record event "${event}", got: ${JSON.stringify(ctx.lastRecord)}`);
    }
    if (ctx.lastRecord.class !== 'control-pause') {
      throw new Error(`expected last record class "control-pause", got: ${JSON.stringify(ctx.lastRecord)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^that record names its source$/, (ctx) => {
    if (typeof ctx.lastRecord.source !== 'string' || ctx.lastRecord.source.length === 0) {
      throw new Error(`expected the record to name a non-empty source, got: ${JSON.stringify(ctx.lastRecord)}`);
    }
  }, FEATURE);

  // ── generic record/corrupt-line Given steps (scenarios 02/06/07/08) ─────
  registry.defineScoped(/^a "([a-z-]+)" record at "([^"]+)"(?: in the "([^"]+)" ledger)?$/, (ctx, event, ts, explicitMonth) => {
    if (!KNOWN_EVENTS.has(event)) {
      throw new Error(`unrecognized record event: "${event}"`);
    }
    const month = explicitMonth || ts.slice(0, 7);
    const record = { ts, event, class: EVENT_TO_CLASS[event], source: EVENT_TO_SOURCE[event] };
    appendRawLedgerLine(ctx.root, month, JSON.stringify(record));
    ctx.lastMonth = month;
  }, FEATURE);

  registry.defineScoped(/^a corrupt line$/, (ctx) => {
    appendRawLedgerLine(ctx.root, ctx.lastMonth, 'not even json {{{');
  }, FEATURE);

  registry.defineScoped(/^no "stop" record was written$/, () => {
    // Documentary - the Given "start" record step above is the only write.
  }, FEATURE);

  registry.defineScoped(/^no matching "pause-end" record$/, () => {
    // Documentary - the Given "pause-start" record step above is the only write.
  }, FEATURE);

  // ── scenario 02/06/07/08: fold ───────────────────────────────────────────
  registry.defineScoped(/^the ledger is folded into intervals$/, (ctx) => {
    ctx.intervals = runFold(ctx.root);
  }, FEATURE);

  registry.defineScoped(/^there is one "(control-pause|swarm-stop)" interval of (\d+) minutes with provenance "(proven|inferred)"$/, (ctx, cls, minutes, provenance) => {
    const matches = ctx.intervals.filter((i) => i.class === cls);
    if (matches.length !== 1) {
      throw new Error(`expected exactly one "${cls}" interval, got: ${JSON.stringify(ctx.intervals)}`);
    }
    const [interval] = matches;
    const actualMinutes = (interval['end-ms'] - interval['start-ms']) / 60000;
    if (actualMinutes !== Number(minutes)) {
      throw new Error(`expected a ${minutes}-minute interval, got ${actualMinutes} minutes: ${JSON.stringify(interval)}`);
    }
    if (interval.provenance !== provenance) {
      throw new Error(`expected provenance "${provenance}", got: ${JSON.stringify(interval)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^no "swarm-stop" interval is emitted for that gap$/, (ctx) => {
    const matches = ctx.intervals.filter((i) => i.class === 'swarm-stop');
    if (matches.length !== 0) {
      throw new Error(`expected no swarm-stop interval for the gap, got: ${JSON.stringify(matches)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^there is one open "control-pause" interval starting at "([^"]+)"$/, (ctx, ts) => {
    const matches = ctx.intervals.filter((i) => i.class === 'control-pause' && i.provenance === 'open');
    if (matches.length !== 1) {
      throw new Error(`expected exactly one open control-pause interval, got: ${JSON.stringify(ctx.intervals)}`);
    }
    ctx.openInterval = matches[0];
    if (ctx.openInterval['start-ms'] !== Date.parse(ts)) {
      throw new Error(`expected the open interval to start at ${ts}, got: ${JSON.stringify(ctx.openInterval)}`);
    }
  }, FEATURE);

  registry.defineScoped(/^it has no end timestamp$/, (ctx) => {
    if (ctx.openInterval['end-ms'] !== null && ctx.openInterval['end-ms'] !== undefined) {
      throw new Error(`expected no end timestamp on the open interval, got: ${JSON.stringify(ctx.openInterval)}`);
    }
  }, FEATURE);

  // ── scenario 03/04: the ungraceful-stop heartbeat close ──────────────────
  registry.defineScoped(/^the handoffd heartbeat file last ticked at "([^"]+)"$/, (ctx, ts) => {
    const hbFile = heartbeatFilePath(ctx.root);
    fs.mkdirSync(path.dirname(hbFile), { recursive: true });
    fs.writeFileSync(hbFile, ts);
  }, FEATURE);

  registry.defineScoped(/^no handoffd heartbeat file exists$/, (ctx) => {
    const hbFile = heartbeatFilePath(ctx.root);
    if (fs.existsSync(hbFile)) {
      fs.rmSync(hbFile);
    }
  }, FEATURE);

  registry.defineScoped(/^the swarm starts at "([^"]+)"$/, (ctx, ts) => {
    execFileSync('bash', [SHELL_WRITER_RUNNER, 'start-with-close', ctx.root, ts, heartbeatFilePath(ctx.root)], { encoding: 'utf8' });
    ctx.intervals = runFold(ctx.root);
  }, FEATURE);

  registry.defineScoped(/^a synthetic "stop" record is appended at "([^"]+)"$/, (ctx, ts) => {
    const filePath = ledgerFilePath(ctx.root, ts);
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    const synthetic = lines.find((r) => r.event === 'stop' && r.ts === ts && r.source === 'heartbeat-inferred');
    if (!synthetic) {
      throw new Error(`expected a synthetic heartbeat-inferred stop record at ${ts}, got: ${JSON.stringify(lines)}`);
    }
  }, FEATURE);

  // ── scenario 05 (Scenario Outline): a write failure never blocks ─────────
  registry.defineScoped(/^the ledger file cannot be written$/, (ctx) => {
    ctx.root = mkRoot();
    const blockedPath = availabilityLedgerFileForMonth(ctx.root, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(blockedPath, { recursive: true });
  }, FEATURE);

  registry.defineScoped(/^a (control pause|swarm stop|swarm start) runs$/, (ctx, operation) => {
    if (!KNOWN_OPERATIONS.has(operation)) {
      throw new Error(`unrecognized Examples <operation> value: "${operation}"`);
    }
    ctx.operation = operation;
    if (operation === 'control pause') {
      try {
        writeControlPauseState(ctx.root, { active: true, untilMs: undefined }, 'acceptance-test:never-blocks');
        ctx.threw = false;
      } catch (e) {
        ctx.threw = true;
        ctx.error = e;
      }
      return;
    }
    const shellOperation = operation === 'swarm stop' ? 'swarm-stop' : 'swarm-start';
    try {
      const out = execFileSync('bash', [SHELL_WRITER_RUNNER, 'never-blocks', ctx.root, shellOperation], { encoding: 'utf8' });
      ctx.threw = false;
      ctx.shellOutput = out.trim();
    } catch (e) {
      ctx.threw = true;
      ctx.error = e;
    }
  }, FEATURE);

  registry.defineScoped(/^it completes normally$/, (ctx) => {
    if (ctx.threw) {
      throw new Error(`expected the ${ctx.operation} operation to complete normally, but it threw: ${ctx.error && ctx.error.message}`);
    }
    if (ctx.operation === 'control pause' && readControlPauseState(ctx.root).active !== true) {
      throw new Error('expected the control pause state to be written despite the ledger write failure');
    }
    if (ctx.operation !== 'control pause' && ctx.shellOutput !== 'OK') {
      throw new Error(`expected the shell operation to report OK, got: ${ctx.shellOutput}`);
    }
  }, FEATURE);

  registry.defineScoped(/^it raises no error to its caller$/, (ctx) => {
    if (ctx.threw || ctx.error !== undefined) {
      throw new Error(`expected no error raised to the caller, got: ${ctx.error && ctx.error.message}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
