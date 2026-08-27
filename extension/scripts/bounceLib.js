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

// Parses role session names from a roles.tsv file (column 4).
function parseRoleSessionsFromTsv(content) {
  if (typeof content !== 'string') {
    return [];
  }
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t')[3])
    .filter((session) => typeof session === 'string' && session.length > 0);
}

// Parses `tmux list-sessions -F '#{session_name}'` output into session names.
function parseTmuxSessionNames(listSessionsOutput) {
  return (listSessionsOutput || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Pure readiness probe: every configured role session is present on the socket.
function isSwarmReady({
  socketExists,
  tmuxListExitCode,
  roleSessions,
  listedSessionNames,
}) {
  if (!socketExists || tmuxListExitCode !== 0) {
    return false;
  }
  if (roleSessions.length === 0) {
    return false;
  }
  const listed = new Set(listedSessionNames);
  return roleSessions.every((session) => listed.has(session));
}

function readTargetPathFromSettings(content) {
  if (typeof content !== 'string') {
    return undefined;
  }
  try {
    const settings = JSON.parse(content);
    const target = settings?.['swarmforge.targetPath'];
    if (typeof target === 'string' && target.trim().length > 0) {
      return target.trim();
    }
  } catch {
    // ignore malformed settings
  }
  return undefined;
}

// Resolves the target repo for --autostart: explicit path arg, env var, then
// extension/.vscode/settings.json (swarmforge.targetPath).
function resolveAutostartTarget({ argv, env, settingsContent }) {
  const flagIdx = argv.indexOf('--autostart');
  if (flagIdx === -1) {
    return null;
  }
  const nextArg = argv[flagIdx + 1];
  if (nextArg && !nextArg.startsWith('-')) {
    return nextArg;
  }
  const fromEnv = env.SWARMFORGE_TARGET_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return readTargetPathFromSettings(settingsContent) ?? null;
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

function buildDevHostLaunchCommand(binary, extensionDir, workspacePath) {
  return { command: binary, args: [`--extensionDevelopmentPath=${extensionDir}`, workspacePath] };
}

function isWslPlatform({ platform, env }) {
  const e = env || {};
  return platform === 'linux' && Boolean(e.WSL_DISTRO_NAME || e.WSL_INTEROP || e.WSLENV);
}

function powershellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function buildWindowsKillOldCommands(extensionPath) {
  const psPath = powershellSingleQuoted(extensionPath);
  const script =
    "$p='" + psPath + "';" +
    "Get-CimInstance Win32_Process |" +
    " Where-Object {" +
    " $_.Name -match '^(Code|Code - Insiders)\\.exe$' -and" +
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

function recordBounceHostCount(priorLiveCount, terminatedCount, launchedCount) {
  const afterKill = Math.max(0, (priorLiveCount || 0) - (terminatedCount || 0));
  return afterKill + (launchedCount || 0);
}

module.exports = {
  parseMarker,
  isMarkerFresh,
  filterDevHostPids,
  decideNextStep,
  parseRoleSessionsFromTsv,
  parseTmuxSessionNames,
  isSwarmReady,
  readTargetPathFromSettings,
  resolveAutostartTarget,
  resolveVsCodeBinary,
  buildDevHostLaunchCommand,
  isWslPlatform,
  buildWindowsKillOldCommands,
  headlessMarkerDecision,
  recordBounceHostCount,
};
