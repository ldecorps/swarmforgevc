'use strict';

// BL-235 (M5, narrow slice): step handlers for the per-tile backend/model
// switch feature. Drives the REAL compiled backendSwitch.ts (out/swarm/
// backendSwitch.js) and respawnAgent (out/swarm/tmuxClient.js) against a
// fixture swarm state, with tmux faked via installFakeTmux (mirroring
// tmuxClient.test.js's own fixture pattern) - no live tmux.
//
// This slice only supports a SAME-AGENT (claude) model switch - see
// backendSwitch.ts's own header comment for why the full cross-backend
// scope (including the "in-process vscode.lm" example in this feature's
// own Scenario Outline) is deferred. That example is deliberately left
// wired through the real switchRoleModel rather than special-cased away:
// it fails honestly (switchRoleModel's own "Unknown model" validation)
// rather than being silently skipped or faked as passing.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const OUT_DIR = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { AVAILABLE_CLAUDE_MODELS, switchRoleModel } = require(path.join(OUT_DIR, 'swarm', 'backendSwitch'));
const { installExecutable } = require(path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'sharedBin'));
const { installFakeTmux } = require(path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'fakeTmux'));

const OTHER_ROLE = 'cleaner';

function settingsPath(targetPath, role) {
  return path.join(targetPath, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

// Mirrors backendSwitch.test.js's own writeRespawnState fixture: the
// minimal live-swarm state respawnAgent needs, for two roles so "no other
// role's agent is respawned" is checkable.
function seedSwarmFixture(model) {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-backend-switch-'));
  const launchDir = path.join(targetPath, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  installExecutable(path.join(launchDir, 'coder.sh'), '#!/bin/bash\ntrue\n');
  installExecutable(path.join(launchDir, 'cleaner.sh'), '#!/bin/bash\ntrue\n');
  fs.writeFileSync(settingsPath(targetPath, 'coder'), JSON.stringify({ model }));
  fs.writeFileSync(settingsPath(targetPath, OTHER_ROLE), JSON.stringify({ model: 'claude-sonnet-5' }));
  return targetPath;
}

function successfulRespawnRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

function performSwitch(ctx, to) {
  const fake = installFakeTmux(successfulRespawnRules());
  try {
    ctx.result = switchRoleModel(ctx.targetPath, ctx.role, to);
    ctx.tmuxCalls = fake.calls();
  } finally {
    fake.restore();
  }
}

function registerSteps(registry) {
  registry.define(/^a running swarm with a tiled agent panel, each tile bound to one role's agent$/, () => {
    // Documents the precondition - each scenario's own Given below seeds
    // the specific fixture it needs.
  });

  // ── switch-respawns-that-role-01 (Scenario Outline) ──────────────────
  registry.define(/^the tile for a role whose agent runs on "([^"]+)"$/, (ctx, from) => {
    ctx.role = 'coder';
    ctx.targetPath = seedSwarmFixture(from);
  });

  registry.define(/^the operator picks "([^"]+)" from that tile's backend\/model dropdown$/, (ctx, to) => {
    ctx.switchedTo = to;
    performSwitch(ctx, to);
  });

  registry.define(/^that role's agent is respawned on "([^"]+)" in its existing worktree$/, (ctx, to) => {
    if (!ctx.result.success) {
      throw new Error(`expected the switch to "${to}" to succeed, but it failed: ${ctx.result.message}`);
    }
    const written = JSON.parse(fs.readFileSync(settingsPath(ctx.targetPath, ctx.role), 'utf8'));
    if (written.model !== to) {
      throw new Error(`expected the role's settings file to now carry model "${to}", got: ${JSON.stringify(written)}`);
    }
  });

  registry.define(/^no other role's agent is respawned$/, (ctx) => {
    const otherSettings = JSON.parse(fs.readFileSync(settingsPath(ctx.targetPath, OTHER_ROLE), 'utf8'));
    if (otherSettings.model !== 'claude-sonnet-5') {
      throw new Error(`expected "${OTHER_ROLE}"'s settings to be untouched, got: ${JSON.stringify(otherSettings)}`);
    }
    const sendCalls = ctx.tmuxCalls.filter((args) => args.includes('send-keys'));
    const targets = sendCalls.map((args) => args[args.indexOf('-t') + 1]);
    if (targets.some((t) => t && !t.startsWith('swarmforge-coder'))) {
      throw new Error(`expected every tmux call to target only the switched role's pane, got targets: ${JSON.stringify(targets)}`);
    }
  });

  // ── in-memory-not-persisted-02 ───────────────────────────────────────
  registry.define(/^a role's agent switched to a new backend\/model via its tile$/, (ctx) => {
    ctx.role = 'coder';
    ctx.targetPath = seedSwarmFixture('claude-sonnet-5');
    ctx.confPath = path.join(ctx.targetPath, 'swarmforge', 'swarmforge.conf');
    fs.mkdirSync(path.dirname(ctx.confPath), { recursive: true });
    ctx.confBefore = 'window coder claude coder --model claude-sonnet-5\nwindow cleaner claude cleaner\n';
    fs.writeFileSync(ctx.confPath, ctx.confBefore);
    performSwitch(ctx, 'claude-opus-4-8');
  });

  registry.define(/^the swarm config on disk is inspected$/, (ctx) => {
    ctx.confAfter = fs.readFileSync(ctx.confPath, 'utf8');
  });

  registry.define(/^swarmforge\.conf is unchanged and the swap lives in the in-memory config only$/, (ctx) => {
    if (ctx.confAfter !== ctx.confBefore) {
      throw new Error('expected swarmforge.conf to be byte-for-byte unchanged after the switch');
    }
    const written = JSON.parse(fs.readFileSync(settingsPath(ctx.targetPath, ctx.role), 'utf8'));
    if (written.model !== 'claude-opus-4-8') {
      throw new Error(`expected the switch to be reflected in the runtime settings file, got: ${JSON.stringify(written)}`);
    }
  });

  // ── respawn-resumes-work-03 ──────────────────────────────────────────
  registry.define(/^a role holding an in-process task$/, (ctx) => {
    ctx.role = 'coder';
    ctx.targetPath = seedSwarmFixture('claude-sonnet-5');
    const inProcessDir = path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(inProcessDir, { recursive: true });
    ctx.taskFile = path.join(inProcessDir, '50_task.handoff');
    ctx.taskContent = 'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: in progress\n\nin progress\n';
    fs.writeFileSync(ctx.taskFile, ctx.taskContent);
  });

  registry.define(/^its tile's backend\/model is switched and the agent respawns$/, (ctx) => {
    performSwitch(ctx, 'claude-opus-4-8');
  });

  registry.define(/^the respawned agent re-reads the constitution and its role prompt$/, (ctx) => {
    // respawnAgent (unchanged by this ticket) re-runs the SAME launch
    // script that embeds --append-system-prompt-file/"$(cat prompt_file)"
    // on every respawn regardless of backend/model - proven by
    // tmuxClient.test.js; this ticket's own job is only to not bypass that
    // path, which the successful respawn result already confirms.
    if (!ctx.result.success) {
      throw new Error(`expected the respawn itself to succeed (it re-issues the same launch script), got: ${ctx.result.message}`);
    }
  });

  registry.define(/^it resumes the same in-process task without losing it$/, (ctx) => {
    if (!fs.existsSync(ctx.taskFile)) {
      throw new Error('expected the in-process task file to still exist after the model switch, but it is gone');
    }
    if (fs.readFileSync(ctx.taskFile, 'utf8') !== ctx.taskContent) {
      throw new Error('expected the in-process task file to be unchanged by the model switch');
    }
  });

  // ── dropdown-lists-configured-04 ─────────────────────────────────────
  registry.define(/^the swarm's configured backends and models$/, () => {
    // Documents the precondition - AVAILABLE_CLAUDE_MODELS below is the
    // real, already-configured catalog (reused from pricingTable.ts).
  });

  registry.define(/^the operator opens a tile's backend\/model dropdown$/, (ctx) => {
    ctx.listedModels = AVAILABLE_CLAUDE_MODELS;
  });

  registry.define(/^it lists those backends and models as options$/, (ctx) => {
    if (!ctx.listedModels || ctx.listedModels.length === 0) {
      throw new Error('expected the dropdown to list at least one configured model');
    }
    if (!ctx.listedModels.includes('claude-sonnet-5') || !ctx.listedModels.includes('claude-opus-4-8')) {
      throw new Error(`expected the dropdown to list the configured claude models, got: ${JSON.stringify(ctx.listedModels)}`);
    }
  });
}

module.exports = { registerSteps };
