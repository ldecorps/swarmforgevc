#!/usr/bin/env node
// Robust extension dev-host bounce (BL-058, cross-platform launch by BL-361).
//
// Contract: exit 0 only after observing a FRESH activation marker written by
// the extension running in Development mode — never on a blind delay. Any
// failed stage exits non-zero naming the stage. If a dev host for this
// extension path is already running, it is terminated first, so a successful
// run always ends with exactly one dev host on the freshly compiled build.
//
// The dev host is launched by VS Code's own command line
// (--extensionDevelopmentPath=<ext-dir>), on every supported platform - no
// GUI automation. Set VSCODE_BIN to name a specific VS Code CLI binary;
// otherwise a platform default is tried, then a bare "code" on PATH.
//
// Stages: compile → vscode-not-found → workspace-not-found →
//         terminate-old-dev-host → launch-trigger / activation-timeout
'use strict';

const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  isMarkerFresh,
  filterDevHostPids,
  decideNextStep,
  resolveVsCodeBinary,
  buildDevHostLaunchCommand,
} = require('./bounceLib');

const EXT_DIR = path.resolve(__dirname, '..');
const WORKSPACE_PATH = path.join(EXT_DIR, 'swarmforge-vc.code-workspace');
const MARKER_PATH = path.join(EXT_DIR, '.dev-activation.json');

const POLL_INTERVAL_MS = 500;
const ATTEMPT_TIMEOUT_MS = Number(process.env.BOUNCE_ATTEMPT_TIMEOUT_MS || 15000);
const TOTAL_TIMEOUT_MS = Number(process.env.BOUNCE_TOTAL_TIMEOUT_MS || 60000);
const MAX_ATTEMPTS = Number(process.env.BOUNCE_MAX_ATTEMPTS || 3);
const KILL_GRACE_MS = 5000;

function fail(stage, message) {
  console.error(`BOUNCE FAILED [stage: ${stage}] ${message}`);
  process.exit(1);
}

function sleep(ms) {
  execFileSync('sleep', [String(ms / 1000)]);
}

function readMarker() {
  try {
    return fs.readFileSync(MARKER_PATH, 'utf8');
  } catch {
    return null;
  }
}

function devHostPids() {
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.status !== 0) {
    return [];
  }
  return filterDevHostPids(ps.stdout, EXT_DIR);
}

// ── stage: compile ───────────────────────────────────────────────────────────
function compile() {
  console.log('bounce: compiling…');
  const result = spawnSync('npm', ['run', 'compile'], { cwd: EXT_DIR, stdio: 'inherit' });
  if (result.status !== 0) {
    fail('compile', 'npm run compile failed; see output above.');
  }
}

// An actual execution probe, not a PATH/stat check - on this host's exact
// WSL trap, a Windows `code` binary resolves on PATH but dies with
// "Exec format error" (missing WSLInterop binfmt registration), so merely
// finding the path is not enough to call it usable.
function isExecutable(binary) {
  const result = spawnSync(binary, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

// ── stage: vscode-not-found / workspace-not-found ────────────────────────────
function checkPrerequisites() {
  const resolved = resolveVsCodeBinary({ platform: process.platform, env: process.env, isExecutable });
  if (resolved.error) {
    fail(resolved.error, resolved.message);
  }
  if (!fs.existsSync(WORKSPACE_PATH)) {
    fail('workspace-not-found', `Workspace file not found at: ${WORKSPACE_PATH}`);
  }
  return resolved.binary;
}

// ── stage: terminate-old-dev-host ────────────────────────────────────────────
function terminateOldDevHosts() {
  const pids = devHostPids();
  if (pids.length === 0) {
    return;
  }
  console.log(`bounce: terminating old dev host(s): ${pids.join(', ')}`);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline && devHostPids().length > 0) {
    sleep(250);
  }
  for (const pid of devHostPids()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  sleep(250);
  const survivors = devHostPids();
  if (survivors.length > 0) {
    fail('terminate-old-dev-host', `Old dev host(s) would not die: ${survivors.join(', ')}`);
  }
}

// ── launch trigger ───────────────────────────────────────────────────────────
// The editor's own command line starts the Extension Development Host
// directly (BL-361) - no GUI automation, on any platform.
function triggerLaunch(vscodeBinary) {
  const { command, args } = buildDevHostLaunchCommand(vscodeBinary, EXT_DIR, WORKSPACE_PATH);
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

// ── stage: launch-trigger / activation-timeout ───────────────────────────────
function launchAndVerify(vscodeBinary) {
  const baselineMs = Date.now();
  const startMs = baselineMs;
  let attempt = 1;
  let attemptStartMs = startMs;

  console.log(`bounce: launching dev host (attempt ${attempt}/${MAX_ATTEMPTS})…`);
  if (!triggerLaunch(vscodeBinary)) {
    console.error('bounce: launch trigger reported an error; will retry per policy.');
  }

  for (;;) {
    sleep(POLL_INTERVAL_MS);
    const step = decideNextStep({
      markerFresh: isMarkerFresh(readMarker(), baselineMs),
      devHostRunning: devHostPids().length > 0,
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      attemptElapsedMs: Date.now() - attemptStartMs,
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
      totalElapsedMs: Date.now() - startMs,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
    });

    switch (step.action) {
      case 'success':
        return;
      case 'retrigger':
        attempt += 1;
        attemptStartMs = Date.now();
        console.log(`bounce: no dev host appeared; retrying launch (attempt ${attempt}/${MAX_ATTEMPTS})…`);
        if (!triggerLaunch(vscodeBinary)) {
          console.error('bounce: launch trigger reported an error; will retry per policy.');
        }
        break;
      case 'fail':
        if (step.stage === 'launch-trigger') {
          fail('launch-trigger', `No dev host appeared after ${MAX_ATTEMPTS} launch attempts.`);
        }
        fail('activation-timeout', `No fresh activation marker within ${TOTAL_TIMEOUT_MS}ms (marker: ${MARKER_PATH}).`);
        break;
      case 'wait':
      default:
        break;
    }
  }
}

function main() {
  compile();
  const vscodeBinary = checkPrerequisites();
  terminateOldDevHosts();
  launchAndVerify(vscodeBinary);

  const pids = devHostPids();
  if (pids.length !== 1) {
    fail(
      'dev-host-count',
      `Expected exactly one dev host after the bounce, found ${pids.length} (${pids.join(', ') || 'none'}).`
    );
  }
  console.log(`bounce: SUCCESS — verified fresh activation, dev host pid ${pids[0]}.`);
}

main();
