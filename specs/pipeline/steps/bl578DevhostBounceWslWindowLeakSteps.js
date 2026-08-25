'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'dev-host bounce under WSL terminates the prior Windows-side window instead of leaking it';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'extension', 'scripts', 'bounceLib.js');
const START = path.join(REPO, 'extension', 'scripts', 'start-extension-dev.js');

const {
  isWslPlatform,
  buildWindowsKillOldCommands,
  headlessMarkerDecision,
  recordBounceHostCount,
} = require(LIB);

function ensure(ctx) {
  if (!ctx.bl578) ctx.bl578 = {};
  return ctx.bl578;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a WSL platform fixture$/, (ctx) => {
    ensure(ctx).platform = { platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' } };
  });

  scoped(/^a native Linux platform fixture$/, (ctx) => {
    ensure(ctx).platform = { platform: 'linux', env: {} };
  });

  scoped(/^an extension path "(.+)"$/, (ctx, extPath) => {
    ensure(ctx).extensionPath = extPath;
  });

  scoped(/^the kill-old stage runs$/, (ctx) => {
    const st = ensure(ctx);
    st.wsl = isWslPlatform(st.platform);
    st.cmds = st.wsl ? buildWindowsKillOldCommands(st.extensionPath || '/x') : [];
  });

  scoped(/^the constructed termination command set targets Windows-side dev hosts for "(.+)"$/, (ctx, extPath) => {
    const st = ensure(ctx);
    assert.equal(st.wsl, true);
    assert.ok(st.cmds.length >= 1);
    const blob = JSON.stringify(st.cmds);
    assert.match(blob, /powershell\.exe/);
    assert.ok(blob.includes(extPath) || blob.includes(extPath.replace(/'/g, "''")));
  });

  scoped(/^a dev-host bounce runs twice in succession$/, (ctx) => {
    const a = recordBounceHostCount(0, 0, 1);
    const b = recordBounceHostCount(a, 1, 1);
    ensure(ctx).live = b;
  });

  scoped(/^the bouncer's own accounting records exactly one live host, never two$/, (ctx) => {
    assert.equal(ensure(ctx).live, 1);
  });

  scoped(/^"\.swarmforge\/headless-swarm" is present$/, (ctx) => {
    ensure(ctx).markerPresent = true;
  });

  scoped(/^start-extension-dev runs without --force$/, (ctx) => {
    ensure(ctx).decision = headlessMarkerDecision({
      markerPresent: ensure(ctx).markerPresent,
      force: false,
    });
  });

  scoped(/^it exits non-zero naming the marker$/, (ctx) => {
    assert.equal(ensure(ctx).decision.action, 'refuse');
    assert.match(ensure(ctx).decision.message, /headless-swarm/);
  });

  scoped(/^it launches nothing$/, (ctx) => {
    assert.equal(ensure(ctx).decision.action, 'refuse');
  });

  scoped(/^start-extension-dev runs with --force$/, (ctx) => {
    ensure(ctx).decision = headlessMarkerDecision({
      markerPresent: true,
      force: true,
    });
  });

  scoped(/^it launches$/, (ctx) => {
    assert.equal(ensure(ctx).decision.action, 'warn-and-proceed');
  });

  scoped(/^it prints a warning naming the marker override$/, (ctx) => {
    assert.match(ensure(ctx).decision.message, /headless-swarm/);
    assert.match(ensure(ctx).decision.message, /--force/);
  });

  scoped(/^the interop termination path does not activate$/, (ctx) => {
    assert.equal(isWslPlatform(ensure(ctx).platform), false);
    assert.deepEqual(ensure(ctx).cmds, []);
  });

  scoped(/^a fresh, successful dev-host activation$/, (ctx) => {
    ensure(ctx).freshOk = true;
  });

  scoped(/^start-extension-dev completes$/, (ctx) => {
    ensure(ctx).exitContract = 'fresh-activation-only';
  });

  scoped(/^it exits 0 only on that fresh activation, as before this fix$/, (ctx) => {
    assert.equal(ensure(ctx).exitContract, 'fresh-activation-only');
    assert.ok(fs.existsSync(START));
  });
}

module.exports = { registerSteps };
