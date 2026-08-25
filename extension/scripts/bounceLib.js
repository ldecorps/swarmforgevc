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

// Ordered platform-specific default install locations to try before falling
// back to a bare "code" resolved from PATH.
function platformVsCodeCandidates(platform) {
  if (platform === 'darwin') {
    return ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'];
  }
  if (platform === 'linux') {
    return ['/usr/share/code/bin/code', '/snap/bin/code'];
  }
  return [];
}

// Resolves which VS Code CLI binary to launch the dev host with (BL-361).
// `env.VSCODE_BIN` names an explicit operator override and is authoritative:
// it is checked alone and never silently replaced by a platform default.
// Otherwise tries platform-specific default install locations, then a bare
// "code" (PATH lookup), stopping at the first candidate `isExecutable`
// confirms can actually run ON THIS HOST. A candidate merely resolving to a
// path is not enough - the WSL cross-arch trap is a binary that resolves
// (it is ON PATH) but cannot execute (missing binfmt interop), so
// `isExecutable` must be an actual execution probe, not a PATH/stat check.
function resolveVsCodeBinary({ platform, env, isExecutable }) {
  const override = env && env.VSCODE_BIN;
  if (override) {
    if (isExecutable(override)) {
      return { binary: override };
    }
    return {
      error: 'vscode-not-found',
      message: `VSCODE_BIN=${override} cannot be executed on this host.`,
    };
  }
  const candidates = [...platformVsCodeCandidates(platform), 'code'];
  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return { binary: candidate };
    }
  }
  return {
    error: 'vscode-not-found',
    message: `No usable VS Code CLI found (tried: ${candidates.join(', ')}). Set VSCODE_BIN to override.`,
  };
}

// Builds the dev-host launch invocation: the editor's own command line, no
// GUI automation. `code --extensionDevelopmentPath=<extensionDir>
// <workspacePath>` opens a new Extension Development Host window running
// the extension in development mode - the same effect as pressing F5 in the
// editor's own UI, on every supported platform.
function buildDevHostLaunchCommand(binary, extensionDir, workspacePath) {
  return { command: binary, args: [`--extensionDevelopmentPath=${extensionDir}`, workspacePath] };
}


// BL-578: WSL vs native — interop kill path only on WSL (WSL_DISTRO_NAME / WSLEnv).
function isWslPlatform({ platform, env }) {
  const e = env || {};
  return platform === 'linux' && Boolean(e.WSL_DISTRO_NAME || e.WSL_INTEROP || e.WSLENV);
}

// Pure: PowerShell Stop-Process for Code.exe mains whose command line carries
// --extensionDevelopmentPath=<extensionPath> (no --type= helpers).
function buildWindowsKillOldCommands(extensionPath) {
  const path = String(extensionPath || '');
  // Single-quote for PowerShell literal; double any embedded single quotes.
  const psPath = path.replace(/'/g, "''");
  const script =
    "$p='" + psPath + "';" +
    "Get-CimInstance Win32_Process |" +
    " Where-Object {" +
    " $_.Name -match '^(Code|Code - Insiders)\.exe$' -and" +
    " $_.CommandLine -like ('*--extensionDevelopmentPath=' + $p + '*') -and" +
    " $_.CommandLine -notlike '*--type=*'" +
    " } |" +
    " ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  return [
    {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', script],
    },
  ];
}

// BL-578: refuse bounce when headless marker present unless --force.
function headlessMarkerDecision({ markerPresent, force }) {
  if (!markerPresent) {
    return { action: 'proceed' };
  }
  if (force) {
    return {
      action: 'warn-and-proceed',
      message: 'BOUNCE WARNING: .swarmforge/headless-swarm present; --force overrides refusal',
    };
  }
  return {
    action: 'refuse',
    message: 'BOUNCE FAILED [stage: headless-swarm] .swarmforge/headless-swarm is present; pass --force to override',
  };
}

// Accounting for consecutive bounce kill+launch cycles (scenario 02).
function recordBounceHostCount(priorLiveCount, terminatedCount, launchedCount) {
  const afterKill = Math.max(0, (priorLiveCount || 0) - (terminatedCount || 0));
  return afterKill + (launchedCount || 0);
}

module.exports = {
  parseMarker,
  isMarkerFresh,
  filterDevHostPids,
  decideNextStep,
  resolveVsCodeBinary,
  buildDevHostLaunchCommand,
  isWslPlatform,
  buildWindowsKillOldCommands,
  headlessMarkerDecision,
  recordBounceHostCount,
};
