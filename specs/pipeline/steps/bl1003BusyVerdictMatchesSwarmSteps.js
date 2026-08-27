'use strict';

// BL-1003: step handlers for "the extension host's busy verdict matches
// the swarm's". Drives the REAL ported isPaneActivelyProcessing (in
// process, via the compiled extension/out module) against the REAL
// Babashka chase_sweep_lib.bb actively-processing? (subprocess, via
// bl1003_classify_pane_runner.bb) over the shared
// specs/features/fixtures/BL-970/ captures - mirrors every other
// acceptance step file's execFileSync-a-real-bb-CLI pattern for the swarm
// side, and reuses the SAME real-process respawn-precheck harness
// bl994LiveScreenGridSteps.js/bl997BusyMarkerAgreementSteps.js already
// established for the extension side. All registrations scoped to this
// feature's own title (registry.defineScoped) - the BL-993/BL-996
// within-file collision lesson this session already hit twice.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_OUT = path.join(REPO_ROOT, 'extension', 'out');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1003_classify_pane_runner.bb');

const FEATURE = "BL-1003 the extension host's busy verdict matches the swarm's";

function babashkaVerdict(text) {
  const out = execFileSync('bb', [RUNNER], { encoding: 'utf8', input: JSON.stringify([text]) });
  return JSON.parse(out)[0];
}

function writeRespawnFixtureRoot(root, role) {
  const stateDir = path.join(root, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\t${role}\tswarmforge-${role}\tCoder\tclaude\ttask\n`);
  const script = path.join(launchDir, `${role}.sh`);
  fs.writeFileSync(script, '#!/bin/bash\ntrue\n');
  fs.chmodSync(script, 0o755);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^the pane snapshot fixtures directory "([^"]+)"$/, (ctx, dir) => {
    ctx.fixtureDir = path.join(REPO_ROOT, dir);
  });

  scoped(/^the pane snapshot fixture "([^"]+)"$/, (ctx, fixture) => {
    ctx.fixtureName = fixture;
    ctx.paneText = fs.readFileSync(path.join(ctx.fixtureDir, fixture), 'utf8');
  });

  // ── the-extension-host-busy-verdict-matches-the-swarms-01 ────────────
  scoped(/^the extension host classifies the snapshot$/, (ctx) => {
    const { isPaneActivelyProcessing } = require(path.join(EXTENSION_OUT, 'panel', 'agentPaneState'));
    ctx.tsVerdict = isPaneActivelyProcessing(ctx.paneText);
    ctx.bbVerdict = babashkaVerdict(ctx.paneText);
  });

  scoped(/^the extension host busy verdict is (true|false)$/, (ctx, expected) => {
    const want = expected === 'true';
    if (ctx.tsVerdict !== want) {
      throw new Error(`"${ctx.fixtureName}": extension host verdict was ${ctx.tsVerdict}, expected ${want}`);
    }
  });

  scoped(/^the swarm's classifier returns the same verdict for that snapshot$/, (ctx) => {
    if (ctx.tsVerdict !== ctx.bbVerdict) {
      throw new Error(
        `"${ctx.fixtureName}": extension host=${ctx.tsVerdict} swarm=${ctx.bbVerdict} - the two sides disagree`
      );
    }
  });

  // ── the-extension-host-busy-verdict-matches-the-swarms-02 ────────────
  scoped(/^a forced respawn precheck runs against that snapshot$/, (ctx) => {
    const { installInProcessTmux } = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'fakeTmux'));
    const { respawnAgent } = require(path.join(EXTENSION_OUT, 'swarm', 'tmuxClient'));
    // BL-948 gate: this file references a control socket, so its fixture
    // root must come from the shared short-base helper, never os.tmpdir().
    const root = mkSocketFixtureRoot('bl1003-respawn-');
    writeRespawnFixtureRoot(root, 'coder');
    const fake = installInProcessTmux([
      { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
      { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
      { subcommand: 'capture-pane', exitCode: 0, stdout: ctx.paneText },
    ]);
    try {
      ctx.respawnResult = respawnAgent(root, 'coder');
    } finally {
      fake.restore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  scoped(/^the respawn is refused as busy: (true|false)$/, (ctx, expected) => {
    const want = expected === 'true';
    const got = ctx.respawnResult.skippedBusy === true;
    if (got !== want) {
      throw new Error(
        `"${ctx.fixtureName}": expected respawn-refused-as-busy=${want}, got ${got} (result: ${JSON.stringify(ctx.respawnResult)})`
      );
    }
  });

  // ── the-extension-host-busy-verdict-matches-the-swarms-03 ────────────
  scoped(/^the extension host is asked whether an agent CLI is present$/, (ctx) => {
    const { isAgentCliRunning } = require(path.join(EXTENSION_OUT, 'panel', 'agentPaneState'));
    // Empty paneCommand isolates the TEXT-based signals (UI_MARKERS etc.) -
    // the axis invariant 2 is actually about; a non-empty known CLI name
    // would short-circuit true regardless of paneText.
    ctx.presence = isAgentCliRunning('', ctx.paneText);
  });

  scoped(/^the agent CLI presence answer is (true|false)$/, (ctx, expected) => {
    const want = expected === 'true';
    if (ctx.presence !== want) {
      throw new Error(`"${ctx.fixtureName}": agent CLI presence was ${ctx.presence}, expected ${want}`);
    }
  });
}

module.exports = { registerSteps };
