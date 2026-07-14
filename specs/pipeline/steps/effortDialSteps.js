'use strict';

// BL-236 (M5, "Suggest" tier only): step handlers for the per-role effort
// dial feature. Drives the REAL compiled effortDial.ts (out/swarm/
// effortDial.js) against a fixture swarm state, with tmux faked via
// installFakeTmux for the respawn scenario - mirrors backendSwitchSteps.js
// (BL-235) exactly, since this ticket reuses that exact mechanism.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const OUT_DIR = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  EFFORT_ORDINAL,
  suggestEffortForRoles,
  hasEffortSetting,
  switchRoleEffort,
} = require(path.join(OUT_DIR, 'swarm', 'effortDial'));
const { installExecutable } = require(path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'sharedBin'));
const { installFakeTmux } = require(path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'fakeTmux'));

function settingsPath(targetPath, role) {
  return path.join(targetPath, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

function seedSwarmFixture(role, agent, settings) {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-effort-dial-'));
  const launchDir = path.join(targetPath, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'sessions.tsv'), `1\t${role}\tswarmforge-${role}\t${role}\t${agent}\n`);
  installExecutable(path.join(launchDir, `${role}.sh`), '#!/bin/bash\ntrue\n');
  if (settings !== undefined) {
    fs.writeFileSync(settingsPath(targetPath, role), JSON.stringify(settings));
  }
  return targetPath;
}

function successfulRespawnRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

function registerSteps(registry) {
  registry.define(/^a running swarm where each role has a reasoning-effort setting$/, () => {
    // Documents the precondition - each scenario's own Given below seeds
    // the specific fixture it needs.
  });

  // ── suggest-effort-per-role-01 ────────────────────────────────────────
  registry.define(/^roles with differing demands, some design-heavy and some mechanical$/, (ctx) => {
    ctx.roles = ['architect', 'specifier', 'cleaner', 'documenter'];
  });

  registry.define(/^the swarm starts$/, (ctx) => {
    ctx.suggestions = suggestEffortForRoles(ctx.roles);
  });

  registry.define(/^the extension suggests a reasoning-effort per role with a one-line rationale$/, (ctx) => {
    if (ctx.suggestions.length !== ctx.roles.length) {
      throw new Error(`expected a suggestion for every role, got ${ctx.suggestions.length} for ${ctx.roles.length} roles`);
    }
    for (const s of ctx.suggestions) {
      if (!s.rationale || s.rationale.includes('\n')) {
        throw new Error(`expected a one-line rationale for "${s.role}", got: ${JSON.stringify(s.rationale)}`);
      }
    }
  });

  registry.define(/^it suggests higher effort for design-heavy roles and lower for mechanical roles$/, (ctx) => {
    const byRole = Object.fromEntries(ctx.suggestions.map((s) => [s.role, s.suggestedEffort]));
    const designHeavyMin = Math.min(EFFORT_ORDINAL[byRole.architect], EFFORT_ORDINAL[byRole.specifier]);
    const mechanicalMax = Math.max(EFFORT_ORDINAL[byRole.cleaner], EFFORT_ORDINAL[byRole.documenter]);
    if (!(designHeavyMin > mechanicalMax)) {
      throw new Error(
        `expected design-heavy roles (architect/specifier) to outrank mechanical roles (cleaner/documenter), got: ${JSON.stringify(byRole)}`
      );
    }
  });

  // ── advisory-not-applied-02 ────────────────────────────────────────────
  registry.define(/^an effort suggestion for a role$/, (ctx) => {
    ctx.role = 'architect';
    ctx.targetPath = seedSwarmFixture(ctx.role, 'claude', { model: 'claude-sonnet-5', effortLevel: 'high' });
    ctx.settingsBefore = fs.readFileSync(settingsPath(ctx.targetPath, ctx.role), 'utf8');
    ctx.suggestion = suggestEffortForRoles([ctx.role])[0];
  });

  registry.define(/^the operator does not accept it$/, () => {
    // Nothing to do - accepting would mean calling switchRoleEffort, which
    // this step deliberately never does.
  });

  registry.define(/^the role's effort is unchanged and the suggestion never applies itself$/, (ctx) => {
    const settingsAfter = fs.readFileSync(settingsPath(ctx.targetPath, ctx.role), 'utf8');
    if (settingsAfter !== ctx.settingsBefore) {
      throw new Error('expected the settings file to be untouched by a mere suggestion, but it changed');
    }
  });

  // ── manual-effort-dial-03 ───────────────────────────────────────────────
  registry.define(/^a role whose backend exposes a reasoning-effort setting$/, (ctx) => {
    ctx.role = 'coder';
    ctx.targetPath = seedSwarmFixture(ctx.role, 'claude', { model: 'claude-sonnet-5', effortLevel: 'low' });
    ctx.confPath = path.join(ctx.targetPath, 'swarmforge', 'swarmforge.conf');
    fs.mkdirSync(path.dirname(ctx.confPath), { recursive: true });
    ctx.confBefore = 'window coder claude coder --effort low\n';
    fs.writeFileSync(ctx.confPath, ctx.confBefore);
  });

  registry.define(/^the operator sets a new effort on that role's dial$/, (ctx) => {
    const fake = installFakeTmux(successfulRespawnRules());
    try {
      ctx.result = switchRoleEffort(ctx.targetPath, ctx.role, 'xhigh');
    } finally {
      fake.restore();
    }
  });

  registry.define(/^that role's agent is respawned with the new effort, in the in-memory config only$/, (ctx) => {
    if (!ctx.result.success) {
      throw new Error(`expected the effort switch to succeed, got: ${ctx.result.message}`);
    }
    const written = JSON.parse(fs.readFileSync(settingsPath(ctx.targetPath, ctx.role), 'utf8'));
    if (written.effortLevel !== 'xhigh') {
      throw new Error(`expected the settings file to carry effortLevel "xhigh", got: ${JSON.stringify(written)}`);
    }
    const confAfter = fs.readFileSync(ctx.confPath, 'utf8');
    if (confAfter !== ctx.confBefore) {
      throw new Error('expected swarmforge.conf to be byte-for-byte unchanged after the effort switch');
    }
  });

  // ── effort-unsupported-04 ────────────────────────────────────────────────
  registry.define(/^a role on a backend that exposes no reasoning-effort setting$/, (ctx) => {
    ctx.role = 'coder';
    ctx.agent = 'codex';
    ctx.targetPath = seedSwarmFixture(ctx.role, ctx.agent, undefined);
  });

  registry.define(/^the operator views that role's effort dial$/, (ctx) => {
    ctx.dialAvailable = hasEffortSetting(ctx.agent);
  });

  registry.define(/^the dial is shown unavailable rather than sending an unsupported setting$/, (ctx) => {
    if (ctx.dialAvailable) {
      throw new Error(`expected the dial to be unavailable for agent "${ctx.agent}"`);
    }
    if (fs.existsSync(settingsPath(ctx.targetPath, ctx.role))) {
      throw new Error('expected no settings file (and so no unsupported argument) for a non-claude-backed role');
    }
  });
}

module.exports = { registerSteps };
