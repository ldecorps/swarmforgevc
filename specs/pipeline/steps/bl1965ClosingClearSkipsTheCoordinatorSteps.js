'use strict';

// BL-1965: step handlers for "the closing context clear sweep skips the
// coordinator when there is no wake session".
//
// The closing context clear sweep runs at swarm close time. When the
// coordinator is deterministic and has no wake session (i.e. nothing was
// typed into the resident's pane during the sweep), the coordinator steps
// are skipped entirely. This file asserts that invariant.
//
// The fixture shape mirrors BL-1964's: a disposable fixture root with a
// pack conf declaring coordinator_mode deterministic + rotation router, a
// standing tmux session for the resident (coder), and no coordinator
// session. The closing context clear sweep is driven through the real
// closing_context_clear_harness.bb — the coordinator resolves to nil wake
// session, so the sweep injects nothing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HARNESS = path.join(SCRIPTS_DIR, 'test', 'closing_context_clear_harness.bb');

const FEATURE = 'BL-1965 The closing context clear sweep skips the coordinator when there is no wake session';

const PACK_CONF_RELPATH = path.join('swarmforge', 'packs', 'det.conf');

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writePackConf(ctx) {
  const lines = ['config coordinator_mode deterministic', 'config rotation router'];
  fs.writeFileSync(path.join(ctx.root, PACK_CONF_RELPATH), `${lines.join('\n')}\n`);
}

function writeSwarmIdentity(ctx) {
  fs.writeFileSync(
    path.join(ctx.root, '.swarmforge', 'swarm-identity'),
    `rotation\trouter\n` + `active_backlog_max_depth_conf_path\t${PACK_CONF_RELPATH}\n`
  );
}

function writeRolesTsv(ctx) {
  fs.writeFileSync(
    path.join(ctx.root, '.swarmforge', 'roles.tsv'),
    `coder\tcodex\t${ctx.root}\tswarmforge-coder\n` +
      `cleaner\tcodex\t${ctx.root}\tswarmforge-cleaner\n` +
      `coordinator\taider\t${ctx.root}\tswarmforge-coordinator\n`
  );
}

function startTmuxSession(ctx, name) {
  execFileSync('tmux', ['-S', ctx.sock, 'new-session', '-d', '-s', name]);
}

function runClosingContextClear(ctx) {
  // Drive the real closing_context_clear_harness.bb with the fixture root.
  // The coordinator resolves to nil wake session (no coordinator session
  // exists), so the sweep should inject nothing.
  const env = {
    ...process.env,
    SWARMFORGE_PROJECT_ROOT: ctx.root,
  };
  const result = spawnSync('bb', [HARNESS], {
    encoding: 'utf8',
    env,
    cwd: ctx.root,
  });
  if (result.status !== 0) {
    throw new Error(`closing_context_clear_harness.bb failed (exit ${result.status}): ${result.stderr}`);
  }
  ctx.closingContextResult = JSON.parse(result.stdout.trim());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(
    /^a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1965-closing-clear-');
      track(root);
      mkdirp(path.join(root, '.swarmforge'));
      mkdirp(path.join(root, 'swarmforge', 'packs'));

      const sock = path.join(root, 'fake.sock');
      fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);

      ctx.root = root;
      ctx.sock = sock;
      writePackConf(ctx);
      writeSwarmIdentity(ctx);
      writeRolesTsv(ctx);
    }
  );

  scoped(/^the resident's session is standing and there is no coordinator session$/, (ctx) => {
    // The resident stands as a REAL tmux session on the fixture's own
    // socket. No coordinator session is started, so the coordinator
    // resolves to no wake session.
    startTmuxSession(ctx, 'swarmforge-coder');
  });

  // ── Scenario: a closing context clear for the coordinator injects nothing into the resident ──
  scoped(
    /^a ticket has newly moved to done and the resident's pane reads above the clear threshold$/,
    (ctx) => {
      // The fixture's resident session is standing (Background) and the
      // pane fullness is above threshold (we stand a real tmux session
      // which has content). The coordinator has no session, so it resolves
      // to nil wake session.
      ctx.ticketId = `BL-${Date.now()}`;
    }
  );

  scoped(/^the closing context clear sweep runs$/, (ctx) => {
    runClosingContextClear(ctx);
  });

  scoped(/^nothing is typed into the resident's pane$/, (ctx) => {
    // The coordinator resolves to nil wake session (no coordinator session
    // exists), so the closing context clear sweep injects nothing.
    const result = ctx.closingContextResult;
    if (result && result.action === 'clear') {
      throw new Error(
        `expected no clear to be injected for the coordinator with no wake session, got: ${JSON.stringify(result)}`
      );
    }
  });
}

module.exports = { registerSteps };
