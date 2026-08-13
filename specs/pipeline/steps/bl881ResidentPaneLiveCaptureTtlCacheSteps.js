'use strict';

// BL-881: step handlers for "Resident-pane live capture TTL cache". Drives
// the REAL compiled bridge module (extension/out/bridge/residentPaneLive.js
// and residentSpyUiHtml.js) directly, same posture as
// backlogFoldersStatusSteps.js - no VS Code API, no webview. The tmux layer
// is doubled in-process via extension/test/helpers/fakeTmux.js, same as
// tmuxDoubleAnswersInProcessSteps.js. Compiled output only: run
// `npm run compile` in extension/ first.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { installInProcessTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));
const {
  captureMonoRouterLiveScreen,
  clearResidentPaneLiveCache,
  RESIDENT_PANE_CACHE_TTL_MS,
} = require(path.join(EXT_DIR, 'out', 'bridge', 'residentPaneLive.js'));
const { getResidentSpyUiHtml } = require(path.join(EXT_DIR, 'out', 'bridge', 'residentSpyUiHtml.js'));

const FEATURE_NAME = 'Resident-pane live capture TTL cache';

function seedProjectRoot() {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bl881-acceptance-'));
  const stateDir = path.join(targetPath, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  fs.writeFileSync(path.join(launchDir, 'coder.claude-settings.json'), JSON.stringify({ model: 'claude-sonnet-5' }));
  return targetPath;
}

function paneTextRules(paneText) {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ];
}

function countCapturePaneCalls(fake) {
  return fake.calls().filter((args) => args.includes('capture-pane')).length;
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a project root with a mono-router live-screen capture surface$/,
    (ctx) => {
      ctx.targetPath = seedProjectRoot();
      // A fresh mkdtemp path never collides with a prior scenario's cache
      // entry, but clearing here keeps this Background's guarantee ("a
      // fresh capture surface") true regardless of ordering.
      clearResidentPaneLiveCache();
    },
    FEATURE_NAME
  );

  // ── overlapping-captures-within-ttl-01 ────────────────────────────────
  registry.defineScoped(
    /^a live-screen capture for a target path has completed$/,
    (ctx) => {
      ctx.fake = installInProcessTmux(paneTextRules('SwarmForge Coder\n> working'));
      ctx.nowMs = 1_700_000_000_000;
      ctx.firstSnapshot = captureMonoRouterLiveScreen(ctx.targetPath, ctx.nowMs);
      ctx.callsAfterFirst = countCapturePaneCalls(ctx.fake);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a second capture for the same target path is requested within the TTL$/,
    (ctx) => {
      ctx.secondSnapshot = captureMonoRouterLiveScreen(ctx.targetPath, ctx.nowMs + 1000);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the second call returns the cached snapshot$/,
    (ctx) => {
      if (ctx.secondSnapshot !== ctx.firstSnapshot) {
        throw new Error('expected the second call within the TTL to return the identical cached snapshot object');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no second synchronous tmux\+filesystem walk starts$/,
    (ctx) => {
      try {
        const callsNow = countCapturePaneCalls(ctx.fake);
        if (callsNow !== ctx.callsAfterFirst) {
          throw new Error(`expected no additional capture-pane calls, had ${ctx.callsAfterFirst}, now ${callsNow}`);
        }
      } finally {
        ctx.fake.restore();
      }
    },
    FEATURE_NAME
  );

  // ── expired-or-cleared-cache-forces-fresh-walk-02 ─────────────────────
  registry.defineScoped(
    /^a cached live-screen snapshot for a target path$/,
    (ctx) => {
      ctx.fake = installInProcessTmux(paneTextRules('SwarmForge Coder\n> working (v1)'));
      ctx.nowMs = 1_700_000_000_000;
      ctx.firstSnapshot = captureMonoRouterLiveScreen(ctx.targetPath, ctx.nowMs);
      ctx.callsAfterFirst = countCapturePaneCalls(ctx.fake);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the TTL has expired or clearResidentPaneLiveCache has been called$/,
    (ctx) => {
      // Exercises the clearResidentPaneLiveCache branch of the "or" -
      // residentPaneLive.property.test.js already proves the TTL-elapsed
      // branch for arbitrary poll-time sequences; this scenario proves the
      // explicit-clear branch through the public capture API, at the SAME
      // instant as the first capture (ctx.nowMs unchanged below), so a
      // fresh walk here can only be explained by the clear, not by elapsed
      // time.
      ctx.fake.setRules(paneTextRules('SwarmForge Coder\n> working (v2)'));
      clearResidentPaneLiveCache();
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a capture for that target path is requested$/,
    (ctx) => {
      ctx.secondSnapshot = captureMonoRouterLiveScreen(ctx.targetPath, ctx.nowMs);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a fresh synchronous walk runs$/,
    (ctx) => {
      const callsNow = countCapturePaneCalls(ctx.fake);
      if (callsNow <= ctx.callsAfterFirst) {
        throw new Error(`expected a fresh capture-pane walk, had ${ctx.callsAfterFirst}, now ${callsNow}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the returned snapshot reflects the new capture$/,
    (ctx) => {
      try {
        const before = ctx.firstSnapshot.resident.paneText;
        const after = ctx.secondSnapshot.resident.paneText;
        if (after === before || !after.includes('(v2)')) {
          throw new Error(`expected the fresh snapshot's paneText to reflect the new capture, before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
        }
      } finally {
        ctx.fake.restore();
      }
    },
    FEATURE_NAME
  );

  // ── poll-interval-does-not-outrun-ttl-03 ──────────────────────────────
  registry.defineScoped(
    /^the Resident Spy Mini App HTML served by the bridge$/,
    (ctx) => {
      ctx.html = getResidentSpyUiHtml();
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its live refresh interval is at least 4 seconds$/,
    (ctx) => {
      const match = /setInterval\(refresh,\s*(\d+)\)/.exec(ctx.html);
      if (!match) {
        throw new Error('expected the served HTML to contain a setInterval(refresh, <ms>) poll loop');
      }
      const intervalMs = Number(match[1]);
      if (intervalMs < 4000) {
        throw new Error(`expected the live refresh interval to be at least 4000ms, got ${intervalMs}ms`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge live-capture TTL is 5 seconds$/,
    () => {
      if (RESIDENT_PANE_CACHE_TTL_MS !== 5000) {
        throw new Error(`expected RESIDENT_PANE_CACHE_TTL_MS to be 5000, got ${RESIDENT_PANE_CACHE_TTL_MS}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
