// Decision logic for the dev-host bounce script (BL-058), kept free of side
// effects so it is unit-testable. start-extension-dev.js owns the process
// spawning, killing, and polling; everything it needs to *decide* lives here.
'use strict';

function parseMarker(content) {
  if (typeof content !== 'string') {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw.activatedAt !== 'string' || typeof raw.pid !== 'number') {
    return null;
  }
  const activatedAtMs = Date.parse(raw.activatedAt);
  if (Number.isNaN(activatedAtMs)) {
    return null;
  }
  return { activatedAtMs, pid: raw.pid };
}

// Fresh means the extension activated at or after the moment the bounce
// started — a marker left by a previous run never counts.
function isMarkerFresh(content, baselineMs) {
  const marker = parseMarker(content);
  return marker !== null && marker.activatedAtMs >= baselineMs;
}

// Picks the dev-host MAIN processes for this extension path out of
// `ps -axo pid=,command=` output. Electron helper subprocesses repeat the
// --extensionDevelopmentPath argument but always carry --type=, so they are
// excluded; killing the main process takes its helpers down with it.
function filterDevHostPids(psOutput, extensionPath) {
  const escapedPath = extensionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathArg = new RegExp(`--extensionDevelopmentPath=${escapedPath}(\\s|$)`);
  const pids = [];
  for (const line of (psOutput || '').split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const [, pid, command] = match;
    if (pathArg.test(command) && !command.includes('--type=')) {
      pids.push(Number(pid));
    }
  }
  return pids;
}

// The retry/timeout policy. Given what the poller observed, decide whether the
// bounce succeeded, should keep waiting, should re-fire the launch trigger, or
// has failed (and at which stage).
function decideNextStep(state) {
  if (state.markerFresh) {
    return { action: 'success' };
  }
  if (state.totalElapsedMs >= state.totalTimeoutMs) {
    return { action: 'fail', stage: 'activation-timeout' };
  }
  if (state.attemptElapsedMs >= state.attemptTimeoutMs) {
    if (state.devHostRunning) {
      // The host is up but activation is still pending; re-firing the trigger
      // now would pile up a second dev host.
      return { action: 'wait' };
    }
    if (state.attempt < state.maxAttempts) {
      return { action: 'retrigger' };
    }
    return { action: 'fail', stage: 'launch-trigger' };
  }
  return { action: 'wait' };
}

module.exports = { parseMarker, isMarkerFresh, filterDevHostPids, decideNextStep };
