'use strict';

// BL-1961: step handler for "the mono-router topology never counts a
// deterministic pack's coordinator as a standing session". Drives the REAL
// mono_router_lib.bb (should-have-standing-session?, via a Babashka probe)
// against a disposable fixture root - never a reimplementation of the
// topology decision.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MONO_ROUTER_LIB = path.join(SCRIPTS_DIR, 'mono_router_lib.bb');
const COORDINATOR_CONFIG_LIB = path.join(SCRIPTS_DIR, 'coordinator_config_lib.bb');

const FEATURE = 'BL-1961 The mono-router topology never counts a deterministic pack\'s coordinator as a standing session';

// BL-1964's own repro shape (QA bounce D1): the pack conf a --pack launch
// persists lives where swarm-identity's active_backlog_max_depth_conf_path
// names it - never the tracked swarmforge/swarmforge.conf.
const PACK_CONF_RELPATH = path.join('swarmforge', 'packs', 'det.conf');
const ORDERED_ROLES = ['coder', 'cleaner', 'architect', 'hardener', 'QA', 'coordinator'];

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1961-router-topology-');
      track(root);
      mkdirp(path.join(root, '.swarmforge', 'launch'));
      mkdirp(path.join(root, 'swarmforge', 'packs'));

      fs.writeFileSync(
        path.join(root, PACK_CONF_RELPATH),
        'config coordinator_mode deterministic\nconfig rotation router\n'
      );
      // The tracked default declares neither - proving the probe below
      // reads the EFFECTIVE pack conf, not this one.
      fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config swarm_name bl1961-fixture\n');
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'swarm-identity'),
        `rotation\trouter\n` + `active_backlog_max_depth_conf_path\t${PACK_CONF_RELPATH}\n`
      );
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'roles.tsv'),
        ORDERED_ROLES.map((role) => `${role}\tcodex\t${root}\tswarmforge-${role}\n`).join('')
      );

      ctx.root = root;
    }
  );

  scoped(/^a stale coordinator launch script and no coordinator session$/, (ctx) => {
    // A launch script left on disk from before the pack went deterministic
    // (BL-1959 stops writing new ones, but an old one may still be there) -
    // this scenario's own point is that the TOPOLOGY decision, not the
    // mere presence of the script, is what keeps the coordinator un-stood.
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'launch', 'coordinator.sh'), '#!/usr/bin/env bash\necho stale\n');
    // No live tmux session exists for the coordinator in this fixture at
    // all (no tmux server is ever started) - alive? is false for every
    // role, matching the Background's own words.
  });

  // ── When ────────────────────────────────────────────────────────────
  scoped(/^the standing sessions of the pack are listed$/, (ctx) => {
    const bbScript = `
      (load-file "${MONO_ROUTER_LIB}")
      (load-file "${COORDINATOR_CONFIG_LIB}")
      (let [conf-text (slurp "${path.join(ctx.root, PACK_CONF_RELPATH)}")
            deterministic? (coordinator-config-lib/deterministic-coordinator? conf-text)
            roles ${JSON.stringify(ORDERED_ROLES)}]
        (doseq [role roles]
          (when (mono-router-lib/should-have-standing-session? roles role deterministic?)
            (println role))))
    `;
    const probePath = path.join(ctx.root, 'probe.bb');
    fs.writeFileSync(probePath, bbScript);
    const result = spawnSync('bb', [probePath], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`probe failed (exit ${result.status}): ${result.stderr}`);
    }
    ctx.standingRoles = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^the coordinator is not among them$/, (ctx) => {
    if (ctx.standingRoles.includes('coordinator')) {
      throw new Error(`expected the coordinator not among the standing roles, got: ${JSON.stringify(ctx.standingRoles)}`);
    }
  });
}

module.exports = { registerSteps };
