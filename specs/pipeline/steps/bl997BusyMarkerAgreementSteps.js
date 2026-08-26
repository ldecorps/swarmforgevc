'use strict';

// BL-997/BL-897: step handlers for "The busy marker agrees across the
// language boundary". Drives the REAL classifiers on both sides against the
// shared fixtures in specs/features/fixtures/BL-997/ - the Babashka side via
// bl997_classify_pane_runner.bb (mirrors every other acceptance step file's
// execFileSync-a-real-bb-CLI pattern, e.g. frontDeskSupervisorRecoverySteps.js),
// the TypeScript side via the compiled extension/out module directly
// in-process (never a subprocess for the extension host's own classifier -
// this ticket's two-layer constraint is about PRODUCTION code, not this
// test's own comparison). Scenario 03 reuses extension/test's own
// installInProcessTmux fake, the same double tmuxClient.test.js's BL-137/
// BL-997 tests already use, so the respawn precheck runs for real end to
// end (capture -> classify -> refuse) rather than re-deriving the decision.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkAgreement } = require('./lib/bl997AgreementCheck');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'specs', 'features', 'fixtures', 'BL-997');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl997_classify_pane_runner.bb');

const FIXTURE_FILES = {
  'a live turn-status frame': 'live-turn-status-frame.txt',
  'an idle prompt': 'idle-prompt.txt',
  'an idle prompt quoting the marker': 'idle-prompt-quoting-the-marker.txt',
};

function babashkaVerdict(fixturePath) {
  return execFileSync('bb', [RUNNER, fixturePath], { encoding: 'utf8' }).trim() === 'true';
}

// Requires the compiled output directly - `npm run compile` must have run
// (this repo's own convention: extension/out/ is gitignored, compiled
// before any test/acceptance run relies on it).
function typescriptVerdict(paneText) {
  const { isPaneActivelyProcessing } = require(path.join(REPO_ROOT, 'extension', 'out', 'panel', 'agentPaneState'));
  return isPaneActivelyProcessing(paneText);
}

function writeRespawnFixtureRoot(root, role) {
  const stateDir = path.join(root, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\t${role}\tswarmforge-${role}\tCoder\tclaude\n`);
  const script = path.join(launchDir, `${role}.sh`);
  fs.writeFileSync(script, '#!/bin/bash\ntrue\n');
  fs.chmodSync(script, 0o755);
}

// BL-425 scoping: "the check fails" alone is already registered unscoped by
// three OTHER tickets' step files (bl944, bl945, dispatchGapSteps) with
// their own ctx shapes; several of this file's other step texts read
// generically enough to risk the same collision. Every registration below
// is scoped to this feature's own title so it can never be shadowed by -
// or shadow - an unrelated ticket's identically-worded step.
const FEATURE = 'The busy marker agrees across the language boundary';

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── both-sides-agree-01 / a-mid-turn-pane-is-never-respawned-03 ─────────
  scoped(/^the shared pane fixture (.+)$/, (ctx, fixtureName) => {
    const file = FIXTURE_FILES[fixtureName];
    if (!file) {
      throw new Error(`unknown shared pane fixture: "${fixtureName}"`);
    }
    ctx.fixtureName = fixtureName;
    ctx.fixturePath = path.join(FIXTURE_DIR, file);
    ctx.paneText = fs.readFileSync(ctx.fixturePath, 'utf8');
  });

  scoped(/^the swarm classifier and the extension-host classifier each classify it$/, (ctx) => {
    ctx.babashka = babashkaVerdict(ctx.fixturePath);
    ctx.typescript = typescriptVerdict(ctx.paneText);
  });

  scoped(/^both return the same verdict$/, (ctx) => {
    try {
      checkAgreement(ctx.babashka, ctx.typescript);
    } catch (err) {
      throw new Error(`"${ctx.fixtureName}": ${err.message}`);
    }
  });

  // ── drift-is-caught-and-named-02 (synthetic disagreement - proves the
  //    CHECK itself, never by mutating a real classifier mid-run) ─────────
  scoped(/^the swarm-side busy definition no longer matches the extension-host one$/, (ctx) => {
    ctx.babashka = true;
    ctx.typescript = false;
  });

  scoped(/^the agreement check runs$/, (ctx) => {
    ctx.checkError = null;
    try {
      checkAgreement(ctx.babashka, ctx.typescript);
    } catch (err) {
      ctx.checkError = err;
    }
  });

  scoped(/^the check fails$/, (ctx) => {
    if (!ctx.checkError) {
      throw new Error('expected the agreement check to fail, but it reported agreement');
    }
  });

  scoped(/^the failure names both literals$/, (ctx) => {
    const msg = ctx.checkError.message;
    if (!/babashka=/.test(msg) || !/typescript=/.test(msg)) {
      throw new Error(`expected the failure to name both verdicts; got: "${msg}"`);
    }
  });

  // ── a-mid-turn-pane-is-never-respawned-03 ────────────────────────────────
  scoped(/^the extension host runs its respawn precheck$/, (ctx) => {
    const { installInProcessTmux } = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'fakeTmux'));
    const { respawnAgent } = require(path.join(REPO_ROOT, 'extension', 'out', 'swarm', 'tmuxClient'));
    // BL-1002/BL-948 gate: socket-referencing step files root fixtures via
    // the shared short-base helper, never os.tmpdir().
    const root = require('./lib/socketFixtureRoot').mkSocketFixtureRoot('bl997-respawn-');
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

  scoped(/^the respawn is refused$/, (ctx) => {
    if (ctx.respawnResult.skippedBusy !== true) {
      throw new Error(`expected the respawn to be refused as busy; got: ${JSON.stringify(ctx.respawnResult)}`);
    }
  });
}

module.exports = { registerSteps };
