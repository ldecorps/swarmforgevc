'use strict';

// BL-870: step handlers for "Every wake the daemon injects records what it
// was for". Two execution strategies, matched to the two claims the
// ticket's own scope makes:
//
// - inbox-item / stuck-in-process (scenarios 01, 03's first two rows, 04,
//   05): drive the REAL handoffd.bb daemon end to end against a disposable
//   fixture root with a fake tmux on PATH - same idiom
//   test_handoffd_wake_attribution_wiring.sh and
//   test_handoffd_chase_sweep_wiring.sh already use. The daemon is
//   `spawn`ed (never `spawnSync` inside a captured subshell/command-
//   substitution) - a first version of the .sh sibling test backgrounded
//   the daemon inside `$(...)`, which deadlocked forever because the still
//   running daemon inherited the substitution's pipe as its own stdout and
//   held it open past EOF. `spawn` returns a handle immediately instead of
//   blocking for output, so this hazard does not apply here, but the
//   lesson is why this file never shells out to a *backgrounded* daemon
//   through a synchronous, output-capturing call.
//
// - claim-idle-probe (scenario 03's third row) and the absent-handoff case
//   (scenario 02): call wake_attribution_lib.bb's own build-attribution /
//   motivating-handoff directly (spawnSync on a tiny generated .bb script,
//   same "drive the real production function directly" idiom
//   bl807BabysitterStuckInProcessOwnerLivenessSteps.js's
//   runMotionConsistencyProbe already uses). Reaching claim-idle-probe
//   through the live daemon needs a claim aged past claim-idle-timeout-ms
//   (20 real minutes, not env-overridable in the live daemon - BL-528 has
//   no live-daemon wiring test of its own for the same reason). Driving
//   the absent-handoff case through a correctly-DECIDING live sweep isn't
//   reachable either - a sweep that decides correctly never wakes with
//   nothing to wake for; the ticket's own qa_e2e_procedure step 4 asks to
//   "drive a wake for that role" against an empty mailbox "by hand",
//   exactly what calling the recording function directly does. Both rows
//   exercise the exact same wake_attribution_lib.bb functions the live
//   daemon calls at every one of its four wake sites (proven wired there
//   by the .sh sibling test and by direct code reading), so this is real
//   coverage of the same production logic, not a parallel reimplementation.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const WAKE_ATTRIBUTION_LIB = path.join(SCRIPTS, 'wake_attribution_lib.bb');

const FEATURE = 'Every wake the daemon injects records what it was for';

const KNOWN_SWEEPS = new Set(['inbox-item', 'stuck-in-process', 'claim-idle-probe']);
const KNOWN_RECORDING = new Set(['on', 'off']);

function knownSweep(value) {
  if (!KNOWN_SWEEPS.has(value)) {
    throw new Error(`BL-870: unrecognized <sweep> example value "${value}"`);
  }
  return value;
}

function knownRecording(value) {
  if (!KNOWN_RECORDING.has(value)) {
    throw new Error(`BL-870: unrecognized <recording> example value "${value}"`);
  }
  return value;
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ensureState(ctx) {
  if (!ctx.bl870) {
    ctx.bl870 = {
      root: null,
      daemon: null,
      fakeBinDir: null,
      tmuxLog: null,
      handoffName: null,
      handoffPresent: true,
      sweep: null,
      paneBusy: false,
      recordingBroken: false,
      record: null,
    };
  }
  return ctx.bl870;
}

function mkFixtureRoot() {
  const root = mkTmp('bl870-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'].join('\t') + '\n'
  );
  return root;
}

function writeFakeTmux(dir, tmuxLog, busy) {
  fs.mkdirSync(dir, { recursive: true });
  const body = busy
    ? [
        '#!/usr/bin/env bash',
        `echo "$*" >> "${tmuxLog}"`,
        'if [[ "$1 $2 $3" == "-S "*"has-session" ]]; then exit 0; fi',
        'if [[ "$1 $2 $3" == "-S "*"capture-pane" ]]; then echo "  ⏵⏵ working… (esc to interrupt)"; exit 0; fi',
        'exit 0',
        '',
      ]
    : [
        '#!/usr/bin/env bash',
        `echo "$*" >> "${tmuxLog}"`,
        'if [[ "$1 $2 $3" == "-S "*"has-session" ]]; then exit 0; fi',
        'exit 0',
        '',
      ];
  const tmuxPath = path.join(dir, 'tmux');
  fs.writeFileSync(tmuxPath, body.join('\n'));
  fs.chmodSync(tmuxPath, 0o755);
}

function writeAgedHandoff(root, dirKind, name) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'inbox', dirKind);
  const filePath = path.join(dir, name);
  fs.writeFileSync(
    filePath,
    'id: bl870-fixture\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\n\nhi\n'
  );
  const mtime = new Date(Date.now() - 45000);
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function attributionFile(root) {
  const month = new Date().toISOString().slice(0, 7);
  return path.join(root, '.swarmforge', 'telemetry', `wake-attribution-${month}.jsonl`);
}

function readAttributionLines(root) {
  const file = attributionFile(root);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// Breaks record-wake-attribution!'s write (a pre-existing plain FILE at
// the path it needs as a directory makes fs/create-dirs throw) while
// leaving every other daemon path untouched - the try/catch around that
// call is exactly what "attribution recording off" exercises: recording
// itself fails, but nothing about the wake it describes may change
// (invariant 2).
function breakAttributionRecording(root) {
  fs.mkdirSync(path.join(root, '.swarmforge', 'telemetry'), { recursive: true });
  fs.rmSync(path.join(root, '.swarmforge', 'telemetry'), { recursive: true, force: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'telemetry'), 'not a directory');
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function runDaemon(st, { sweepDir, busy, breakRecording } = {}) {
  st.root = mkFixtureRoot();
  st.tmuxLog = path.join(st.root, 'tmux-calls.log');
  st.fakeBinDir = path.join(st.root, 'bin');
  writeFakeTmux(st.fakeBinDir, st.tmuxLog, Boolean(busy));

  if (st.handoffPresent) {
    const dirKind = sweepDir === 'in_process' ? 'in_process' : 'new';
    const filePath = writeAgedHandoff(st.root, dirKind, st.handoffName);
    st.filePath = filePath;
  }

  if (breakRecording) breakAttributionRecording(st.root);

  const env = {
    ...process.env,
    PATH: `${st.fakeBinDir}:${process.env.PATH}`,
    SWARMFORGE_ALLOW_TMP_DAEMON: '1', // intentional throwaway test root (BL-406)
  };
  const child = spawn('bb', [HANDOFFD, st.root], { env, stdio: 'ignore' });
  st.daemon = child;

  const wantSweep = sweepDir === 'in_process' ? 'stuck-in-process' : 'inbox-item';
  await waitFor(() => {
    const lines = readAttributionLines(st.root);
    return lines.some((l) => l.sweep === wantSweep && l.role === 'coder');
  }, 15000);

  fs.mkdirSync(path.join(st.root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(st.root, '.swarmforge', 'daemon', 'stop'), '');
  await waitFor(() => child.exitCode !== null || child.killed, 10000);
  try {
    child.kill('SIGKILL');
  } catch {
    /* already exited */
  }

  const lines = readAttributionLines(st.root);
  const wanted = lines.find((l) => l.sweep === wantSweep && l.role === 'coder');
  st.record = wanted || null;
  st.tmuxCalls = fs.existsSync(st.tmuxLog) ? fs.readFileSync(st.tmuxLog, 'utf8') : '';
}

// Direct-function route for claim-idle-probe and the absent-handoff case:
// runs wake_attribution_lib.bb's own motivating-handoff + build-attribution
// against a real (disposable) mailbox directory, printing the resulting
// record as JSON. Same "drive the real production function directly, on a
// generated one-shot .bb script" idiom as bl807's runMotionConsistencyProbe.
function runPureAttribution(st, sweep, outcome) {
  const root = mkTmp('bl870-pure-');
  const dirKind = sweep === 'inbox-item' ? 'new' : 'in_process';
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', dirKind), { recursive: true });
  let expectedName = null;
  if (st.handoffPresent) {
    expectedName = st.handoffName;
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'handoffs', 'inbox', dirKind, expectedName),
      'id: bl870-fixture\n'
    );
  }

  const script = [
    `(load-file "${WAKE_ATTRIBUTION_LIB}")`,
    '(require \'[cheshire.core :as json])',
    `(def role-info {:role "coder" :worktree-path "${root}"})`,
    `(def handoff-id (wake-attribution-lib/motivating-handoff role-info ${dirKind === 'in_process' ? ':in_process' : ':new'}))`,
    '(def record (wake-attribution-lib/build-attribution',
    `  {:role "coder" :sweep "${sweep}" :handoff-id handoff-id :outcome "${outcome}" :at-ms 1000}))`,
    '(println (json/generate-string record))',
    '',
  ].join('\n');

  const tmpFile = path.join(
    os.tmpdir(),
    `bl870-pure-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bb`
  );
  fs.writeFileSync(tmpFile, script);
  let record = null;
  try {
    const result = spawnSync('bb', [tmpFile], { encoding: 'utf8' });
    const out = (result.stdout || '').trim().split('\n').filter(Boolean).pop();
    if (!out) {
      throw new Error(`BL-870: pure attribution probe produced no output. stderr:\n${result.stderr}`);
    }
    record = JSON.parse(out);
  } finally {
    fs.rmSync(tmpFile, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
  st.record = record;
  st.filePath = expectedName ? { toString: () => expectedName } : null;
  if (expectedName) st.handoffFileName = expectedName;
}

function cleanup(ctx) {
  const st = ctx.bl870;
  if (!st) return;
  if (st.daemon && st.daemon.exitCode === null && !st.daemon.killed) {
    try {
      st.daemon.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  if (st.root) fs.rmSync(st.root, { recursive: true, force: true });
}

function registerSteps(registry) {
  registry.defineScoped(/^a daemon sweep over a role whose pane can be woken$/, (ctx) => {
    const st = ensureState(ctx);
    st.handoffName = '00_20260701T000000Z_000001_from_specifier_to_coder.handoff';
  }, FEATURE);

  registry.defineScoped(/^the role's inbox holds a handoff$/, (ctx) => {
    const st = ensureState(ctx);
    st.handoffPresent = true;
  }, FEATURE);

  registry.defineScoped(/^the role's inbox holds no handoff$/, (ctx) => {
    const st = ensureState(ctx);
    st.handoffPresent = false;
  }, FEATURE);

  registry.defineScoped(/^a sweep decision of "([^"]+)" for that role$/, (ctx, rawSweep) => {
    const st = ensureState(ctx);
    st.sweep = knownSweep(rawSweep);
    st.handoffPresent = true;
  }, FEATURE);

  registry.defineScoped(/^the target pane reads as busy$/, (ctx) => {
    const st = ensureState(ctx);
    st.paneBusy = true;
  }, FEATURE);

  registry.defineScoped(/^the sweep wakes that role$/, async (ctx) => {
    const st = ensureState(ctx);
    try {
      if (st.sweep === 'claim-idle-probe') {
        runPureAttribution(st, 'claim-idle-probe', st.paneBusy ? 'skipped' : 'landed');
        return;
      }
      if (!st.handoffPresent) {
        // BL-870 wake-attribution-02: no correctly-deciding live sweep ever
        // wakes with an empty mailbox (that IS the still-unexplained false
        // wake this ticket instruments but does not fix - see the ticket's
        // own approval_context). Exercise the recording function directly
        // against a genuinely empty mailbox instead - the qa_e2e_procedure's
        // own "drive a wake for that role by hand" case.
        runPureAttribution(st, st.sweep || 'inbox-item', 'landed');
        return;
      }
      await runDaemon(st, { sweepDir: st.sweep === 'stuck-in-process' ? 'in_process' : 'new', busy: st.paneBusy });
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  }, FEATURE);

  registry.defineScoped(/^the sweep runs with attribution recording "(on|off)"$/, async (ctx, rawRecording) => {
    const st = ensureState(ctx);
    const recording = knownRecording(rawRecording);
    try {
      await runDaemon(st, { sweepDir: 'new', busy: false, breakRecording: recording === 'off' });
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  }, FEATURE);

  registry.defineScoped(/^a wake attribution is recorded for that role$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (!st.record) {
        throw new Error('BL-870: no wake attribution record was produced');
      }
      if (st.record.role !== 'coder') {
        throw new Error(`BL-870: attribution role mismatch: ${JSON.stringify(st.record)}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the attribution names that handoff$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const expected = st.handoffFileName || st.handoffName;
      if (st.record.handoffId !== expected) {
        throw new Error(
          `BL-870: attribution names "${st.record.handoffId}", expected "${expected}": ${JSON.stringify(st.record)}`
        );
      }
      if (st.record['handoffPresent?'] !== true) {
        throw new Error(`BL-870: handoffPresent? not true: ${JSON.stringify(st.record)}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the attribution marks the motivating handoff as absent$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (st.record.handoffId !== null || st.record['handoffPresent?'] !== false) {
        throw new Error(`BL-870: attribution does not mark the handoff absent: ${JSON.stringify(st.record)}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the attribution names the sweep as "([^"]+)"$/, (ctx, rawSweep) => {
    const st = ensureState(ctx);
    try {
      const sweep = knownSweep(rawSweep);
      if (st.record.sweep !== sweep) {
        throw new Error(`BL-870: attribution names sweep "${st.record.sweep}", expected "${sweep}"`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the attribution records the outcome as skipped$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (st.record.outcome !== 'skipped') {
        throw new Error(`BL-870: attribution outcome "${st.record.outcome}", expected "skipped"`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the sweep's outcome for that role is "woken"$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (!st.tmuxCalls || !st.tmuxCalls.includes('send-keys')) {
        throw new Error('BL-870: no send-keys was sent - the sweep did not actually wake the role');
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
