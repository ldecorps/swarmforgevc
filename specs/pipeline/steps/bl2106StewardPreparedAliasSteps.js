'use strict';

// BL-2106: step handlers for "the steward probes a local coder through a
// prepared alias" - gates the shared prepare path (local_model_prepare_lib.bb,
// local_model_prepare_cli.bb, the frozen Modelfile template, and
// model_steward_cli.bb's `prepare` subcommand plus `probe --prepare`'s
// one re-probe on the empty-implement fail shape), landed on main in
// 1e64496d93 and reviewed here.
//
// Scenarios 01/02/04 drive the REAL model_steward_cli.bb "prepare"
// subcommand directly from its real location in the checkout (BL-1235:
// "the handler drives that CLI", the same pattern BL-1700's own step
// handler uses for "probe") - MODEL_STEWARD_STATE_DIR points it at a
// disposable temp dir, and a fake ollama first on PATH records every call
// and creates nothing real. Scenario 03 calls the real, pure
// `local-model-prepare-lib/empty-response-fail-shape?` directly (no CLI,
// no process, no model) against constructed scorecards matching each
// Example's prose.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-2106 The steward probes a local coder through a prepared alias';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEWARD_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');
const PREPARE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_model_prepare_lib.bb');

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function snapshotGuardedPaths() {
  const packsDir = path.join(REPO_ROOT, 'swarmforge', 'packs');
  const confSnapshot = fs
    .readdirSync(packsDir)
    .filter((name) => name.endsWith('.conf'))
    .sort()
    .map((name) => {
      const stat = fs.statSync(path.join(packsDir, name));
      return `${name}:${stat.size}:${stat.mtimeMs}`;
    });
  const launchDir = path.join(REPO_ROOT, '.swarmforge', 'launch');
  const dayShiftFile = path.join(REPO_ROOT, '.swarmforge', 'day_shift_pack');
  return {
    confSnapshot,
    launchExists: fs.existsSync(launchDir),
    dayShiftExists: fs.existsSync(dayShiftFile),
    dayShiftContent: fs.existsSync(dayShiftFile) ? fs.readFileSync(dayShiftFile, 'utf8') : null,
  };
}

function ensure(ctx) {
  if (ctx.bl2106) {
    return ctx.bl2106;
  }
  const root = trackedTmpRoot('bl2106-steward-');
  const stateDir = path.join(root, 'state');
  const fakeBinDir = path.join(root, 'fakebin');
  const callsLog = path.join(root, 'calls.log');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(callsLog, '');
  // Records every call verbatim; always exits 0 - `prepare!` throws on a
  // failed create, and no scenario here exercises that path.
  writeExecutable(
    path.join(fakeBinDir, 'ollama'),
    ['#!/usr/bin/env bash', 'set -uo pipefail', 'echo "$*" >> "${CALLS_LOG:?missing CALLS_LOG}"', 'exit 0', ''].join('\n')
  );
  const st = {
    root,
    stateDir,
    fakeBinDir,
    callsLog,
    guardedBefore: snapshotGuardedPaths(),
    lastProfile: null,
    lastRun: null,
    lastDecision: null,
  };
  ctx.bl2106 = st;
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(async () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  return st;
}

function callsLogLines(st) {
  return fs
    .readFileSync(st.callsLog, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

function runPrepare(ctx, tag, flagsText) {
  const st = ensure(ctx);
  const flags = flagsText === 'no size flags' ? [] : flagsText.split(/\s+/).filter(Boolean);
  const args = [STEWARD_CLI, 'prepare', tag, ...flags];
  const result = spawnSync('bb', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${st.fakeBinDir}:${process.env.PATH}`,
      MODEL_STEWARD_STATE_DIR: st.stateDir,
      CALLS_LOG: st.callsLog,
    },
    timeout: 30000,
  });
  st.lastRun = result;
  assert.equal(result.status, 0, `model_steward_cli.bb prepare exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  const lines = result.stdout.trim().split('\n');
  st.lastProfile = JSON.parse(lines[lines.length - 1]);
  return st.lastProfile;
}

// A Clojure data literal for a plain JS value - strings/numbers/booleans,
// and arrays/objects of them. Enough for the fixed summary/scorecard
// shapes below; never a general EDN serializer.
function clj(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(clj).join(' ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([k, v]) => `:${k} ${clj(v)}`)
      .join(' ')}}`;
  }
  return 'nil';
}

function fixtureScorecards(count, outcome, wallSeconds) {
  return Array.from({ length: count }, (_, i) => ({
    fixtureId: `coder-0${i + 1}`,
    outcome,
    wallSeconds,
  }));
}

// The four Examples rows, translated from prose into the exact
// {handedOff, of, verdict} summary and coder scorecards
// empty-response-fail-shape? reads.
const SUMMARY_CASES = {
  '0 of 5 handed off, every coder fixture no model commit in 12 s': {
    summary: { handedOff: 0, of: 5, verdict: 'fail' },
    scorecards: fixtureScorecards(5, 'no model commit', 12),
  },
  '0 of 5 handed off, one coder fixture no model commit in 90 s': {
    summary: { handedOff: 0, of: 5, verdict: 'fail' },
    scorecards: fixtureScorecards(1, 'no model commit', 90),
  },
  '2 of 5 handed off': {
    summary: { handedOff: 2, of: 5, verdict: 'fail' },
    scorecards: [],
  },
  // Scorecards whose members DISAGREE (2 fast no-commit, 3 slow) - the
  // only shape that can tell empty-response-fail-shape?'s real `every?`
  // apart from a weakened `some?`. Every row above either has a single
  // coder scorecard, an empty list, or every member agreeing, so none of
  // them can distinguish the two (hardener constitution: "A predicate
  // the caller FOLDS over a collection needs a fixture whose members
  // DISAGREE"). Confirmed by hand-mutating every?->some? in
  // local_model_prepare_lib.bb: every other row here still passed.
  '0 of 5 handed off, two coder fixtures fast and three slow no-commit': {
    summary: { handedOff: 0, of: 5, verdict: 'fail' },
    scorecards: [...fixtureScorecards(2, 'no model commit', 12), ...fixtureScorecards(3, 'no model commit', 90)],
  },
};

function judgeSummary(summaryText) {
  const testCase = SUMMARY_CASES[summaryText];
  assert.ok(testCase, `unknown probe-summary example value "${summaryText}"`);
  const script = [
    `(load-file ${JSON.stringify(PREPARE_LIB)})`,
    `(println (local-model-prepare-lib/empty-response-fail-shape? ${clj(testCase.summary)} ${clj(testCase.scorecards)}))`,
  ].join('\n');
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, `empty-response-fail-shape? eval failed:\n${result.stdout}\n${result.stderr}`);
  const printed = result.stdout.trim();
  assert.ok(printed === 'true' || printed === 'false', `unexpected eval output: ${printed}`);
  return printed === 'true';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an empty steward state directory$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a fake ollama on the PATH that records every call$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the steward prepares "([^"]+)" with "([^"]+)"$/, (ctx, tag, flagsText) => {
    runPrepare(ctx, tag, flagsText);
  });

  scoped(/^the prepared Modelfile's FROM line names "([^"]+)"$/, (ctx, tag) => {
    const st = ensure(ctx);
    const modelfile = fs.readFileSync(st.lastProfile.modelfilePath, 'utf8');
    assert.match(modelfile, new RegExp(`^FROM ${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });

  scoped(/^the prepared Modelfile sets num_ctx (\d+) and num_predict (\d+)$/, (ctx, numCtx, numPredict) => {
    const st = ensure(ctx);
    const modelfile = fs.readFileSync(st.lastProfile.modelfilePath, 'utf8');
    assert.match(modelfile, new RegExp(`^PARAMETER num_ctx ${numCtx}$`, 'm'));
    assert.match(modelfile, new RegExp(`^PARAMETER num_predict ${numPredict}$`, 'm'));
  });

  scoped(/^the fake ollama was asked to create the prepared alias from that Modelfile$/, (ctx) => {
    const st = ensure(ctx);
    const expected = `create ${st.lastProfile.alias} -f ${st.lastProfile.modelfilePath}`;
    assert.ok(callsLogLines(st).includes(expected), `expected a call "${expected}", calls were: ${callsLogLines(st).join(' | ')}`);
  });

  scoped(/^the think-off profile sets think false for every id the prepared alias is called by$/, (ctx) => {
    const st = ensure(ctx);
    const settings = fs.readFileSync(st.lastProfile.aiderSettingsPath, 'utf8');
    const nameCount = (settings.match(/^- name:/gm) || []).length;
    const thinkFalseCount = (settings.match(/^\s*think: false$/gm) || []).length;
    assert.ok(nameCount > 0, 'expected at least one aider model id in the think-off profile');
    assert.equal(thinkFalseCount, nameCount, 'expected every aider model id to set think: false');
  });

  scoped(/^the fake ollama was never called$/, (ctx) => {
    const st = ensure(ctx);
    assert.deepEqual(callsLogLines(st), [], 'expected --dry-run to never shell to ollama');
  });

  scoped(/^a probe summary of (.+) is judged$/, (ctx, summaryText) => {
    const st = ensure(ctx);
    st.lastDecision = judgeSummary(summaryText);
  });

  scoped(/^the steward (re-probes once through prepare|does not re-probe)$/, (ctx, decision) => {
    const st = ensure(ctx);
    assert.equal(st.lastDecision, decision === 're-probes once through prepare');
  });

  scoped(/^no file under swarmforge\/packs, \.swarmforge\/launch or the day-shift config changed$/, (ctx) => {
    const st = ensure(ctx);
    assert.deepEqual(snapshotGuardedPaths(), st.guardedBefore);
  });
}

module.exports = { registerSteps };
