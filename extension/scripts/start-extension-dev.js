#!/usr/bin/env node
// Robust extension dev-host bounce (BL-058).
//
// Contract: exit 0 only after observing a FRESH activation marker written by
// the extension running in Development mode — never on a blind delay. Any
// failed stage exits non-zero naming the stage. If a dev host for this
// extension path is already running, it is terminated first, so a successful
// run always ends with exactly one dev host on the freshly compiled build.
//
// Stages: compile → vscode-not-found → workspace-not-found →
//         terminate-old-dev-host → launch-trigger / activation-timeout
//         [--autostart] autostart → autostart-timeout
//
// With --autostart, after the F5-equivalent launch activates the extension host
// the script writes the remote bounce sentinel (swarm) so agents launch through
// the SwarmForge tmux socket — never via a standalone tmux session.
'use strict';

const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  isMarkerFresh,
  filterDevHostPids,
  decideNextStep,
  resolveAutostartTarget,
  parseRoleSessionsFromTsv,
  parseTmuxSessionNames,
  isSwarmReady,
} = require('./bounceLib');

const EXT_DIR = path.resolve(__dirname, '..');
const WORKSPACE_PATH = path.join(EXT_DIR, 'swarmforge-vc.code-workspace');
const MARKER_PATH = path.join(EXT_DIR, '.dev-activation.json');
const SETTINGS_PATH = path.join(EXT_DIR, '.vscode', 'settings.json');
const REMOTE_BOUNCE = path.join(EXT_DIR, '..', 'swarmforge', 'scripts', 'remote_bounce.sh');
const VSCODE_APP = process.env.VSCODE_APP || '/Applications/Visual Studio Code.app';
const AUTOSTART_SETTLE_MS = Number(process.env.SWARM_AUTOSTART_SETTLE_MS || 1000);
const AUTOSTART_TIMEOUT_MS = Number(process.env.SWARM_AUTOSTART_TIMEOUT_MS || 120000);
const AUTOSTART_POLL_MS = Number(process.env.SWARM_AUTOSTART_POLL_MS || 2000);

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

// ── stage: vscode-not-found / workspace-not-found ────────────────────────────
function checkPrerequisites() {
  if (!fs.existsSync(VSCODE_APP)) {
    fail('vscode-not-found', `VS Code not found at: ${VSCODE_APP} (set VSCODE_APP to override).`);
  }
  if (!fs.existsSync(WORKSPACE_PATH)) {
    fail('workspace-not-found', `Workspace file not found at: ${WORKSPACE_PATH}`);
  }
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
// The standard CLI on this machine does not reliably start an Extension
// Development Host directly, so the trigger opens the workspace and presses
// F5 (key code 96) to fire the "Run Extension" launch configuration.
function triggerLaunch() {
  const open = spawnSync('open', ['-a', 'Visual Studio Code', WORKSPACE_PATH]);
  if (open.status !== 0) {
    return false;
  }
  const script = [
    'tell application "Visual Studio Code" to activate',
    'delay 2',
    'tell application "System Events" to tell process "Code" to key code 96',
  ].join('\n');
  const osa = spawnSync('osascript', ['-e', script]);
  return osa.status === 0;
}

// ── stage: launch-trigger / activation-timeout ───────────────────────────────
function launchAndVerify() {
  const baselineMs = Date.now();
  const startMs = baselineMs;
  let attempt = 1;
  let attemptStartMs = startMs;

  console.log(`bounce: launching dev host (attempt ${attempt}/${MAX_ATTEMPTS})…`);
  if (!triggerLaunch()) {
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
        if (!triggerLaunch()) {
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

function readSettingsContent() {
  try {
    return fs.readFileSync(SETTINGS_PATH, 'utf8');
  } catch {
    return null;
  }
}

function readSocketPath(targetPath) {
  const socketFile = path.join(targetPath, '.swarmforge', 'tmux-socket');
  try {
    return fs.readFileSync(socketFile, 'utf8').trim();
  } catch {
    return '';
  }
}

function probeSwarmReady(targetPath) {
  const socketPath = readSocketPath(targetPath);
  const socketExists = socketPath.length > 0;
  let rolesContent = '';
  try {
    rolesContent = fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8');
  } catch {
    // no roles file yet
  }
  const tmux = socketExists
    ? spawnSync('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}'], {
        encoding: 'utf8',
      })
    : { status: 1, stdout: '' };
  return isSwarmReady({
    socketExists,
    tmuxListExitCode: tmux.status ?? 1,
    roleSessions: parseRoleSessionsFromTsv(rolesContent),
    listedSessionNames: parseTmuxSessionNames(tmux.stdout),
  });
}

function triggerSwarmAutostart(targetPath) {
  if (!fs.existsSync(REMOTE_BOUNCE)) {
    fail('autostart', `remote_bounce.sh not found at: ${REMOTE_BOUNCE}`);
  }
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  if (!fs.existsSync(swarmforgeDir)) {
    fail('autostart', `target has no .swarmforge directory: ${targetPath}`);
  }

  console.log(`bounce: autostart — triggering swarm via remote_bounce.sh for ${targetPath}`);
  console.log(
    'bounce: autostart — agents must run on the SwarmForge tmux socket, not a standalone tmux session.'
  );

  const result = spawnSync('bash', [REMOTE_BOUNCE, targetPath, 'swarm'], { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'unknown error').trim();
    fail('autostart', `remote_bounce.sh swarm failed: ${detail}`);
  }
}

function waitForSwarmAutostart(targetPath) {
  const deadline = Date.now() + AUTOSTART_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (probeSwarmReady(targetPath)) {
      console.log('bounce: autostart — swarm is ready on the SwarmForge tmux socket.');
      return;
    }
    sleep(AUTOSTART_POLL_MS);
  }
  const launchLog = path.join(targetPath, '.swarmforge', 'last-launch.log');
  fail(
    'autostart-timeout',
    `Swarm did not become ready within ${AUTOSTART_TIMEOUT_MS}ms. Check ${launchLog} and the extension host output.`
  );
}

function main() {
  const autostartTarget = resolveAutostartTarget({
    argv: process.argv,
    env: process.env,
    settingsContent: readSettingsContent(),
  });

  compile();
  checkPrerequisites();
  terminateOldDevHosts();
  launchAndVerify();

  const pids = devHostPids();
  if (pids.length !== 1) {
    fail(
      'dev-host-count',
      `Expected exactly one dev host after the bounce, found ${pids.length} (${pids.join(', ') || 'none'}).`
    );
  }
  console.log(`bounce: SUCCESS — verified fresh activation, dev host pid ${pids[0]}.`);

  if (!autostartTarget) {
    return;
  }

  sleep(AUTOSTART_SETTLE_MS);
  triggerSwarmAutostart(autostartTarget);
  waitForSwarmAutostart(autostartTarget);
  console.log('bounce: AUTOSTART SUCCESS — extension host and swarm are up.');
}

main();
