'use strict';

// BL-1964: step handlers for "on a deterministic router pack the
// coordinator resolves to no wake session while every dormant role still
// resolves to the resident". Drives the REAL handoff_lib.bb
// resolve-wake-session / wake-session path over a disposable fixture root -
// never a reimplementation of the resolver's own decision logic.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const FEATURE =
  'BL-1964 On a deterministic router pack the coordinator resolves to no wake session';

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

// BL-1964 QA bounce D1: the pack conf lives where a real `--pack` launch
// persists it (swarm-identity's active_backlog_max_depth_conf_path, via
// backlog_depth_lib.bb's conf-file-path) - never the tracked swarmforge/
// swarmforge.conf, which this fixture deliberately leaves declaring
// NEITHER rotation nor coordinator_mode, so a probe that fell back to
// reading it would see the wrong (false/non-router) answer.
const PACK_CONF_RELPATH = path.join('swarmforge', 'packs', 'det.conf');

function writeConf(ctx) {
  const lines = [];
  if (ctx.deterministicMode) {
    lines.push('config coordinator_mode deterministic');
  }
  lines.push('config rotation router');
  fs.mkdirSync(path.join(ctx.root, 'swarmforge', 'packs'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, PACK_CONF_RELPATH), `${lines.join('\n')}\n`);
  // The tracked default: declares neither directive, so reading it instead
  // of the effective pack conf fails the deterministic/router checks both.
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'config swarm_name bl1964-fixture\n');
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
    `rotation\trouter\n` + `active_backlog_max_depth_conf_path\t${PACK_CONF_RELPATH}\n`
  );
}

// BL-1964 QA bounce D1/D2: the fixture's standing sessions are REAL tmux
// sessions on the fixture's own socket - the real wake-session's
// session-exists? reads them, so the resolver's configured-exists? /
// resident-exists? inputs are what the fixture actually stands, never a
// hard-coded expectation. The socket path is fixture-owned (fake.sock in
// the root), so the shared reaper's killTmuxServer never touches a live
// swarm socket.
function startTmuxSession(ctx, name) {
  execFileSync('tmux', ['-S', ctx.sock, 'new-session', '-d', '-s', name]);
}

function runResolveProbe(ctx, session) {
  // Drive the REAL wake-session (the IO wrapper under test, not just its
  // pure resolve-wake-session half - BL-1964 QA bounce D2) against the
  // fixture's own project root, via set-project-root! exactly as a real
  // pipeline role's own process does. session-exists? reads the fixture's
  // own socket, so the resolver's existence inputs are whatever the
  // fixture actually stands (BL-1964 QA bounce D1/D2).
  const bbScript = `
    (load-file "${path.join(SCRIPTS_DIR, 'handoff_lib.bb')}")
    (handoff-lib/set-project-root! "${ctx.root}")
    (let [result (handoff-lib/wake-session "${ctx.sock}" "${session}")]
      (if (nil? result)
        (println "nil")
        (println result)))
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
      fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);

      ctx.root = root;
      ctx.sock = sock;
      ctx.deterministicMode = true;
      writeConf(ctx);
      writeRolesTsv(ctx);
      writeSwarmIdentity(ctx);
    }
  );

  scoped(/^the resident's session is standing and there is no coordinator session$/, (ctx) => {
    // The resident stands as a REAL tmux session on the fixture's own
    // socket (BL-1964 QA bounce D1): the real wake-session's
    // session-exists? reads it, so resident-exists? is what the fixture
    // actually stands. No coordinator session is started, so
    // configured-exists? is false for it.
    startTmuxSession(ctx, 'swarmforge-coder');
    ctx.residentSession = 'swarmforge-coder';
  });

  // ── Given ───────────────────────────────────────────────────────────
  scoped(/^the fixture pack's "config coordinator_mode deterministic" line is removed$/, (ctx) => {
    ctx.deterministicMode = false;
    writeConf(ctx);
  });

  scoped(/^a coordinator session exists$/, (ctx) => {
    // BL-1964 QA bounce D2: the coordinator's own session is a REAL tmux
    // session on the fixture's socket, so the real wake-session's
    // configured-exists? reads it - the resolver's first branch applies
    // because the fixture stands it, never because the handler hard-codes
    // the expected answer.
    startTmuxSession(ctx, 'swarmforge-coordinator');
  });

  // ── When ────────────────────────────────────────────────────────────
  scoped(/^the wake session for the coordinator is resolved$/, (ctx) => {
    ctx.coordinatorWake = runResolveProbe(ctx, 'swarmforge-coordinator');
  });

  scoped(/^the wake session for a dormant cleaner is the resident's$/, (ctx) => {
    // BL-1964 QA bounce D1: the step's own name IS the assertion - the
    // real wake-session must return the resident's session for the
    // dormant cleaner (invariant 2).
    ctx.cleanerWake = runResolveProbe(ctx, 'swarmforge-cleaner');
    if (ctx.cleanerWake !== ctx.residentSession) {
      throw new Error(
        `expected the resident session ${ctx.residentSession} for the dormant cleaner; got: ${ctx.cleanerWake}`
      );
    }
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^no session is returned$/, (ctx) => {
    if (ctx.coordinatorWake !== 'nil') {
      throw new Error(
        `expected no session (nil) for the coordinator; got: ${ctx.coordinatorWake}`
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
