'use strict';

// BL-361: step handlers for "The extension dev host can be started from a
// shell on Linux, not only on macOS". Drives the REAL production pure
// helpers in extension/scripts/bounceLib.js (resolveVsCodeBinary,
// buildDevHostLaunchCommand, filterDevHostPids, isMarkerFresh,
// decideNextStep) with injected doubles for the one genuinely external
// boundary (actually executing/spawning a VS Code binary or a real ps
// listing) - the same "fake only the environmentally unsuitable seam"
// posture the CLI thin-main rule exists for. start-extension-dev.js's own
// main()/compile()/terminateOldDevHosts() orchestration is NOT driven here:
// it spawns real npm compile and a real editor, which is exactly the
// live-process-interaction class of unsuitable module the testability
// boundary excludes (same posture as tmux/PTY). The real end-to-end proof
// against an installed VS Code is QA's e2e procedure (the ticket's notes),
// not this acceptance run.

const path = require('node:path');
const {
  resolveVsCodeBinary,
  buildDevHostLaunchCommand,
  filterDevHostPids,
  isMarkerFresh,
  decideNextStep,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'bounceLib'));
const swarmEnsureSource = require('node:fs').readFileSync(
  path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'swarm_ensure.bb'),
  'utf8'
);

const EXT_DIR = '/repo/extension';
const WORKSPACE_PATH = '/repo/extension/swarmforge-vc.code-workspace';

const PLATFORM_DEFAULT_BINARY = {
  darwin: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  linux: '/usr/share/code/bin/code',
};

function registerSteps(registry) {
  // ── linux-dev-host-launcher-01 (Scenario Outline: linux, darwin) ────────
  registry.define(/^the host platform is (linux|darwin)$/, (ctx, platform) => {
    ctx.platform = platform;
  });

  registry.define(/^a usable VS Code is installed$/, (ctx) => {
    const usableBinary = PLATFORM_DEFAULT_BINARY[ctx.platform] || 'code';
    ctx.isExecutable = (candidate) => candidate === usableBinary;
  });

  registry.define(/^the dev-host launcher runs$/, (ctx) => {
    ctx.resolved = resolveVsCodeBinary({ platform: ctx.platform, env: ctx.env || {}, isExecutable: ctx.isExecutable });
    if (!ctx.resolved.error) {
      ctx.launchCommand = buildDevHostLaunchCommand(ctx.resolved.binary, EXT_DIR, WORKSPACE_PATH);
    }
  });

  registry.define(/^VS Code is asked to open the extension in development mode$/, (ctx) => {
    if (ctx.resolved.error) {
      throw new Error(`expected resolution to succeed, got error: ${ctx.resolved.message}`);
    }
    if (!ctx.launchCommand.args.includes(`--extensionDevelopmentPath=${EXT_DIR}`)) {
      throw new Error(`expected the launch command to open the extension in development mode, got: ${JSON.stringify(ctx.launchCommand)}`);
    }
  });

  registry.define(/^the launcher uses no GUI keystroke automation$/, (ctx) => {
    const serialized = JSON.stringify(ctx.launchCommand);
    if (ctx.launchCommand.command === 'open' || ctx.launchCommand.command === 'osascript' || /osascript|key code|System Events/.test(serialized)) {
      throw new Error(`expected no GUI keystroke automation, got: ${serialized}`);
    }
  });

  // ── linux-dev-host-launcher-02 ───────────────────────────────────────────
  registry.define(/^it reports success only after observing a fresh activation marker$/, () => {
    const baselineMs = Date.parse('2026-07-14T12:00:00Z');
    const staleMarker = '{"activatedAt":"2026-07-14T11:59:59.000Z","pid":1}';
    const freshMarker = '{"activatedAt":"2026-07-14T12:00:05.000Z","pid":1}';

    if (isMarkerFresh(staleMarker, baselineMs)) {
      throw new Error('expected a marker from before the launcher started to never count as success');
    }
    if (decideNextStep({ markerFresh: false, devHostRunning: true, attempt: 1, maxAttempts: 3, attemptElapsedMs: 0, attemptTimeoutMs: 15000, totalElapsedMs: 0, totalTimeoutMs: 60000 }).action === 'success') {
      throw new Error('expected no success while no fresh marker has been observed, even with a dev host running');
    }
    if (!isMarkerFresh(freshMarker, baselineMs)) {
      throw new Error('expected a marker written after the launcher started to be fresh');
    }
    if (decideNextStep({ markerFresh: true, devHostRunning: true, attempt: 1, maxAttempts: 3, attemptElapsedMs: 0, attemptTimeoutMs: 15000, totalElapsedMs: 0, totalTimeoutMs: 60000 }).action !== 'success') {
      throw new Error('expected success once a fresh activation marker is observed');
    }
  });

  // ── linux-dev-host-launcher-03 ───────────────────────────────────────────
  registry.define(/^an older dev host is already running for this extension$/, (ctx) => {
    ctx.oldPid = 4242;
    ctx.psBefore = `  ${ctx.oldPid} Electron --extensionDevelopmentPath=${EXT_DIR}\n`;
  });

  registry.define(/^it ends with exactly one dev host, on the freshly compiled build$/, (ctx) => {
    const oldPids = filterDevHostPids(ctx.psBefore, EXT_DIR);
    if (oldPids.length !== 1 || oldPids[0] !== ctx.oldPid) {
      throw new Error(`expected the old dev host to be detected for termination, got: ${JSON.stringify(oldPids)}`);
    }
    // After termination, the launcher's own triggerLaunch (proven by
    // scenario 01 to invoke the resolved VS Code binary directly) starts a
    // NEW dev host process - simulated here by a ps listing with a
    // different pid for the same extension path.
    const newPid = 5150;
    const psAfter = `  ${newPid} Electron --extensionDevelopmentPath=${EXT_DIR}\n`;
    const survivingPids = filterDevHostPids(psAfter, EXT_DIR);
    if (survivingPids.length !== 1) {
      throw new Error(`expected exactly one dev host after the bounce, got: ${JSON.stringify(survivingPids)}`);
    }
    if (survivingPids[0] === ctx.oldPid) {
      throw new Error('expected the surviving dev host to be the freshly-launched one, not the terminated one');
    }
  });

  // ── linux-dev-host-launcher-04 ────────────────────────────────────────────
  registry.define(/^the only VS Code found cannot be executed on this host$/, (ctx) => {
    ctx.platform = ctx.platform || 'linux';
    // The WSL trap: `command -v code` would succeed (it IS on PATH), but
    // actually executing it fails - isExecutable must reflect that, never a
    // bare path/PATH-resolution check.
    ctx.isExecutable = () => false;
  });

  registry.define(/^it fails naming the stage that no usable VS Code was found$/, (ctx) => {
    if (ctx.resolved.error !== 'vscode-not-found') {
      throw new Error(`expected a vscode-not-found failure, got: ${JSON.stringify(ctx.resolved)}`);
    }
  });

  registry.define(/^it does not wait out the activation timeout$/, (ctx) => {
    // resolveVsCodeBinary is a plain synchronous function - a Promise would
    // mean the caller could be waiting on I/O or a timer before failing.
    if (ctx.resolved && typeof ctx.resolved.then === 'function') {
      throw new Error('expected resolution to fail synchronously, without waiting on anything');
    }
    if (ctx.resolved.error === 'activation-timeout' || ctx.resolved.error === 'launch-trigger') {
      throw new Error('expected the failure to be distinct from the launch-retry/activation-timeout stages, not routed through them');
    }
  });

  // ── linux-dev-host-launcher-05 ────────────────────────────────────────────
  registry.define(/^the operator names the VS Code to use$/, (ctx) => {
    ctx.platform = ctx.platform || 'linux';
    ctx.namedBinary = '/opt/custom-vscode/bin/code';
    ctx.env = { VSCODE_BIN: ctx.namedBinary };
    ctx.isExecutable = (candidate) => candidate === ctx.namedBinary;
  });

  registry.define(/^the named VS Code is the one launched$/, (ctx) => {
    if (ctx.resolved.error) {
      throw new Error(`expected resolution to succeed with the named override, got error: ${ctx.resolved.message}`);
    }
    if (ctx.resolved.binary !== ctx.namedBinary) {
      throw new Error(`expected the operator-named binary to be used, got: ${ctx.resolved.binary}`);
    }
  });

  // ── linux-dev-host-launcher-06 ─────────────────────────────────────────────
  registry.define(/^the extension is not running on a Linux host$/, (ctx) => {
    ctx.platform = 'linux';
    ctx.psNoDevHost = '  1 /sbin/init\n';
  });

  registry.define(/^the swarm ensures its extension component$/, (ctx) => {
    // Structural proof, not a real ./swarm ensure run (which would need a
    // real installed VS Code - QA's job per the ticket). Confirms the
    // wiring this ticket's notes call out stays unchanged: swarm_ensure.bb
    // still shells to start-extension-dev.sh for repair, and the health
    // probe's own filterDevHostPids keeps recognizing a dev host launched
    // by the NEW CLI-based mechanism (same --extensionDevelopmentPath= flag
    // as before), so a repaired extension is detected as healthy.
    ctx.bounceCmdWired = /extension-bounce-cmd[\s\S]*start-extension-dev\.sh/.test(swarmEnsureSource);
    ctx.unhealthyBefore = filterDevHostPids(ctx.psNoDevHost, EXT_DIR).length === 0;
    const launchCommand = buildDevHostLaunchCommand(PLATFORM_DEFAULT_BINARY.linux, EXT_DIR, WORKSPACE_PATH);
    const psAfterRepair = `  9001 Electron ${launchCommand.args.join(' ')}\n`;
    ctx.healthyAfter = filterDevHostPids(psAfterRepair, EXT_DIR).length === 1;
  });

  registry.define(/^the extension component is reported as repaired$/, (ctx) => {
    if (!ctx.bounceCmdWired) {
      throw new Error("expected swarm_ensure.bb's extension-bounce-cmd to still wire to start-extension-dev.sh");
    }
    if (!ctx.unhealthyBefore) {
      throw new Error('expected the extension to be reported unhealthy before repair');
    }
    if (!ctx.healthyAfter) {
      throw new Error('expected the health probe to recognize the CLI-launched dev host as healthy after repair');
    }
  });
}

module.exports = { registerSteps };
