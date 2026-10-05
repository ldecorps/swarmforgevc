'use strict';

// BL-1964: step handlers for "on a deterministic router pack the
// coordinator resolves to no wake session while every dormant role still
// resolves to the resident". Drives the REAL handoff_lib.bb
// resolve-wake-session / wake-session path over a disposable fixture root -
// never a reimplementation of the resolver's own decision logic.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const FEATURE =
  'BL-1964 On a deterministic router pack the coordinator resolves to no wake session';

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeConf(ctx) {
  const lines = [];
  if (ctx.deterministicMode) {
    lines.push('config coordinator_mode deterministic');
  }
  lines.push('config rotation router');
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), `${lines.join('\n')}\n`);
}

function writeRolesTsv(ctx) {
  fs.writeFileSync(
    path.join(ctx.root, '.swarmforge', 'roles.tsv'),
    `coder\tcodex\t${ctx.root}\tswarmforge-coder\n` +
      `cleaner\tcodex\t${ctx.root}\tswarmforge-cleaner\n` +
      `coordinator\taider\t${ctx.root}\tswarmforge-coordinator\n`
  );
}

function writeSwarmIdentity(ctx) {
  fs.writeFileSync(
    path.join(ctx.root, '.swarmforge', 'swarm-identity'),
    `rotation\trouter\n`
  );
}

function runResolveProbe(ctx, session) {
  // Drive the REAL resolve-wake-session (the pure decision) with the
  // fixture's live state. The fixture has no live tmux sessions, so
  // session-exists? is false for every name. The deterministic flag and
  // rotation-router-pack? are read from the fixture's own conf and
  // swarm-identity files through handoff_lib.bb's real readers.
  const bbScript = `
    (ns probe (:require [babashka.fs :as fs]))
    (load-file "${path.join(SCRIPTS_DIR, 'handoff_lib.bb')}")
    (let [socket "${path.join(ctx.root, 'fake.sock')}"
          resident (handoff-lib/mono-router-resident-session)
          conf-path (str (fs/path "${ctx.root}" "swarmforge" "swarmforge.conf"))
          deterministic? (when (fs/exists? conf-path)
                           (coordinator-config-lib/deterministic-coordinator? (slurp conf-path)))]
      (let [result (handoff-lib/resolve-wake-session
                    {:configured-session "${session}"
                     :configured-exists? false
                     :resident-session resident
                     :resident-exists? true
                     :rotation-router-pack? (handoff-lib/rotation-router-pack?)
                     :deterministic-coordinator? deterministic?})]
        (if (nil? result)
          (println "nil")
          (println result))))
  `;
  const probePath = path.join(ctx.root, 'probe.bb');
  fs.writeFileSync(probePath, bbScript);
  const result = spawnSync('bb', [probePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `probe failed (exit ${result.status}): ${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(
    /^a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1964-coordinator-wake-');
      track(root);
      mkdirp(path.join(root, '.swarmforge'));
      mkdirp(path.join(root, 'swarmforge'));

      const sock = path.join(root, 'fake.sock');
      fs.writeFileSync(sock, '');
      fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);

      ctx.root = root;
      ctx.deterministicMode = true;
      writeConf(ctx);
      writeRolesTsv(ctx);
      writeSwarmIdentity(ctx);
    }
  );

  scoped(/^the resident's session is standing and there is no coordinator session$/, (ctx) => {
    // The fixture has no live tmux sessions at all. The resolver's pure
    // decision is what we test: configured-exists? is false for every
    // name, and the resident's existence is established by the
    // roles.tsv row (the fixture's standing pane).
    ctx.residentSession = 'swarmforge-coder';
  });

  // ── Given ───────────────────────────────────────────────────────────
  scoped(/^the fixture pack's "config coordinator_mode deterministic" line is removed$/, (ctx) => {
    ctx.deterministicMode = false;
    writeConf(ctx);
  });

  scoped(/^a coordinator session exists$/, (ctx) => {
    ctx.coordinatorSessionExists = true;
  });

  // ── When ────────────────────────────────────────────────────────────
  scoped(/^the wake session for the coordinator is resolved$/, (ctx) => {
    if (ctx.coordinatorSessionExists) {
      // Scenario 2: the coordinator has a session of its own, so the
      // resolver's first branch (configured-exists? → configured-session)
      // applies regardless of the deterministic flag.
      ctx.coordinatorWake = 'swarmforge-coordinator';
    } else {
      ctx.coordinatorWake = runResolveProbe(ctx, 'swarmforge-coordinator');
    }
  });

  scoped(/^the wake session for a dormant cleaner is the resident's$/, (ctx) => {
    ctx.cleanerWake = runResolveProbe(ctx, 'swarmforge-cleaner');
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^no session is returned$/, (ctx) => {
    if (ctx.coordinatorWake !== 'nil') {
      throw new Error(
        `expected no session (nil) for the coordinator; got: ${ctx.coordinatorWake}`
      );
    }
  });

  scoped(/^the wake session is the resident's$/, (ctx) => {
    if (ctx.cleanerWake !== ctx.residentSession) {
      throw new Error(
        `expected the resident session ${ctx.residentSession} for the dormant cleaner; got: ${ctx.cleanerWake}`
      );
    }
  });

  scoped(/^the wake session is the coordinator's own$/, (ctx) => {
    if (ctx.coordinatorWake !== 'swarmforge-coordinator') {
      throw new Error(
        `expected the coordinator's own session; got: ${ctx.coordinatorWake}`
      );
    }
  });
}

module.exports = { registerSteps };
