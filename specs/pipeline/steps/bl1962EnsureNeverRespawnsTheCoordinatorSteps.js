'use strict';

// BL-1962: step handler for "swarm ensure never respawns a deterministic
// pack's coordinator seat". Drives the REAL swarm_ensure.bb against a
// disposable fixture root with a fake tmux - never a reimplementation of
// the ensure/topology decision. Mirrors BL-1963's own
// bl1963BabysitterRaisesNoCoordinatorFindingSteps.js fixture shape, adapted
// for swarm_ensure.bb's own extension/daemon/operator/babysitterd side
// components (headless marker + a fake daemon pid skip them cleanly).
//
// roles.tsv names ONLY the coordinator role - classify-role's "resident =
// first non-coordinator role" is then nil, so the coordinator is the only
// row the per-role loop ever processes and no OTHER role's seat-healthy?
// (a real process-tree cmdline match this fixture cannot fake) is ever
// reached.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ENSURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_ensure.bb');

const FEATURE = "BL-1962 swarm ensure never respawns a deterministic pack's coordinator seat";

const PACK_CONF_RELPATH = path.join('swarmforge', 'packs', 'det.conf');
const DETERMINISTIC_LINE = 'config coordinator_mode deterministic\n';
const ROUTER_LINE = 'config rotation router\n';

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

// A minimal fake tmux: has-session/list-panes read a per-root "sessions"
// directory (one empty file per live session name); new-session/respawn-pane
// create or touch it; kill-session removes it. Never a real tmux server -
// the point is to prove swarm_ensure's OWN decision (never call
// has-session/new-session for the coordinator at all under a deterministic
// pack), not to simulate a real pane.
function writeFakeTmux(ctx) {
  const bin = path.join(ctx.root, 'bin');
  mkdirp(bin);
  ctx.sessionsDir = path.join(ctx.root, 'fake-sessions');
  mkdirp(ctx.sessionsDir);
  const script = [
    '#!/usr/bin/env bash',
    'set -u',
    'args=("$@")',
    'sub="${args[2]:-}"',
    'rest=("${args[@]:3}")',
    `sessdir=${JSON.stringify(ctx.sessionsDir)}`,
    'mkdir -p "$sessdir"',
    'case "$sub" in',
    '  has-session)',
    '    name="${rest[1]#=}"',
    '    [ -f "${sessdir:?}/${name:?}" ] && exit 0 || exit 1',
    '    ;;',
    '  new-session)',
    '    name=""',
    '    for i in "${!rest[@]}"; do',
    '      if [ "${rest[$i]}" = "-s" ]; then name="${rest[$((i+1))]}"; fi',
    '    done',
    '    touch "${sessdir:?}/${name:?}"',
    '    exit 0',
    '    ;;',
    '  respawn-pane)',
    '    exit 0',
    '    ;;',
    '  kill-session)',
    '    name="${rest[1]#=}"',
    '    rm -f "${sessdir:?}/${name:?}"',
    '    exit 0',
    '    ;;',
    '  list-panes)',
    '    name="${rest[1]#=}"',
    '    [ -f "${sessdir:?}/${name:?}" ] || exit 1',
    '    echo "0"',
    '    exit 0',
    '    ;;',
    '  *)',
    '    exit 0',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'tmux'), script);
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  ctx.fakeBin = bin;
}

function packConfText(deterministic) {
  return (deterministic ? DETERMINISTIC_LINE : '') + ROUTER_LINE;
}

function runEnsure(ctx) {
  // BL-461/BL-763's own rule (test_swarm_ensure.sh's make_fixture): a dev
  // box routinely has real Telegram/Cursor-bridge creds exported, which
  // would otherwise make front-desk/cursor-bridge think they are
  // configured and attempt a real restart - scrubbed here for the same
  // reason, never relying on SWARMFORGE_SKIP_FRONT_DESK alone (cursor-bridge
  // has no such skip flag).
  const env = { ...process.env };
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_CHAT_ID;
  delete env.TELEGRAM_PRINCIPAL_USER_ID;
  delete env.CURSOR_BRIDGE_BOT_TOKEN;
  const result = spawnSync('bb', [ENSURE, ctx.root], {
    encoding: 'utf8',
    env: {
      ...env,
      PATH: `${ctx.fakeBin}:${process.env.PATH}`,
      SWARMFORGE_SKIP_OPERATOR: '1',
      SWARMFORGE_SKIP_FRONT_DESK: '1',
      SWARMFORGE_SKIP_BABYSITTERD: '1',
      SWARM_ENSURE_RECHECK_ATTEMPTS: '1',
      SWARM_ENSURE_RECHECK_INTERVAL_MS: '1',
    },
  });
  ctx.ensureResult = result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1962-ensure-');
      mkdirp(path.join(root, '.swarmforge', 'launch'));
      mkdirp(path.join(root, '.swarmforge', 'daemon'));
      mkdirp(path.join(root, 'swarmforge', 'packs'));
      mkdirp(path.join(root, 'backlog', 'active'));

      fs.writeFileSync(path.join(root, PACK_CONF_RELPATH), packConfText(true));
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'swarm-identity'),
        `rotation\trouter\n` + `active_backlog_max_depth_conf_path\t${path.join(root, PACK_CONF_RELPATH)}\n`
      );
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'roles.tsv'),
        ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'].join('\t') + '\n'
      );

      // Skips the extension-bounce check entirely (ensure's own
      // headless-swarm marker), and a fake daemon pid (this test process's
      // own pid, same survival trick test_swarm_ensure.sh's make_fixture
      // uses) satisfies daemon-healthy? - neither is this ticket's concern.
      fs.writeFileSync(path.join(root, '.swarmforge', 'headless-swarm'), '');
      fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'), String(process.pid));
      fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));

      ctx.bl1962 = { root };
      writeFakeTmux(ctx.bl1962);
    }
  );

  scoped(/^a stale coordinator launch script and no coordinator session$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.bl1962.root, '.swarmforge', 'launch', 'coordinator.sh'), '#!/usr/bin/env bash\necho stale\n');
    fs.chmodSync(path.join(ctx.bl1962.root, '.swarmforge', 'launch', 'coordinator.sh'), 0o755);
    // No file under fake-sessions/ for swarmforge-coordinator - has-session
    // reads "no session", matching the Background's own words.
  });

  scoped(/^the fixture pack's "config coordinator_mode deterministic" line is removed$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.bl1962.root, PACK_CONF_RELPATH), packConfText(false));
  });

  scoped(/^swarm ensure runs$/, (ctx) => {
    runEnsure(ctx.bl1962);
  });

  scoped(/^no swarmforge-coordinator session exists$/, (ctx) => {
    assert.ok(
      !fs.existsSync(path.join(ctx.bl1962.sessionsDir, 'swarmforge-coordinator')),
      `expected no swarmforge-coordinator session, got: ${ctx.bl1962.ensureResult.stdout}`
    );
  });

  scoped(/^swarm ensure exits zero$/, (ctx) => {
    assert.equal(
      ctx.bl1962.ensureResult.status,
      0,
      `expected exit 0, got ${ctx.bl1962.ensureResult.status}: ${ctx.bl1962.ensureResult.stdout}${ctx.bl1962.ensureResult.stderr}`
    );
  });

  scoped(/^no coordinator line of its report reads FAILED or FIXED$/, (ctx) => {
    const lines = ctx.bl1962.ensureResult.stdout.split('\n').filter((l) => l.includes('coordinator'));
    const bad = lines.filter((l) => l.includes('FAILED') || l.includes('FIXED'));
    assert.deepEqual(bad, [], `expected no FAILED/FIXED coordinator line, got:\n${lines.join('\n')}`);
  });

  scoped(/^a swarmforge-coordinator session exists$/, (ctx) => {
    assert.ok(
      fs.existsSync(path.join(ctx.bl1962.sessionsDir, 'swarmforge-coordinator')),
      `expected a swarmforge-coordinator session to have been created, got: ${ctx.bl1962.ensureResult.stdout}${ctx.bl1962.ensureResult.stderr}`
    );
  });
}

module.exports = { registerSteps };
