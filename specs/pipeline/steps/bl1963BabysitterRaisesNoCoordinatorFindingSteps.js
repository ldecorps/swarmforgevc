'use strict';

// BL-1963: step handler for "a babysitter sweep neither flags nor repairs
// the missing coordinator pane on a deterministic pack". Drives the REAL
// babysitter_check.bb (should-stand-role? via the gatherer) against a
// disposable fixture root - never a reimplementation of the topology
// decision.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS_DIR, 'babysitter_check.sh');

const FEATURE = 'BL-1963 A babysitter sweep never flags or repairs a deterministic pack\'s missing coordinator pane';

// BL-1964's own repro shape: the pack conf a --pack launch persists lives
// where swarm-identity's active_backlog_max_depth_conf_path names it.
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
      const root = mkSocketFixtureRoot('bl1963-babysitter-');
      track(root);
      mkdirp(path.join(root, '.swarmforge', 'launch'));
      mkdirp(path.join(root, 'swarmforge', 'packs'));
      mkdirp(path.join(root, '.swarmforge', 'handoffs', 'failed'));
      mkdirp(path.join(root, 'backlog', 'active'));

      fs.writeFileSync(
        path.join(root, PACK_CONF_RELPATH),
        'config coordinator_mode deterministic\nconfig rotation router\n'
      );
      fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config swarm_name bl1963-fixture\n');
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'swarm-identity'),
        `rotation\trouter\n` + `active_backlog_max_depth_conf_path\t${path.join(root, PACK_CONF_RELPATH)}\n`
      );
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'roles.tsv'),
        ORDERED_ROLES.map((role) => `${role}\tcodex\t${root}\tswarmforge-${role}\n`).join('')
      );

      // Minimal git fixture so the pipeline-code-on-main check resolves.
      const { execSync } = require('node:child_process');
      execSync(`git -C "${root}" -c user.email=t@t -c user.name=t init -q -b main`, { stdio: 'pipe' });
      execSync(`git -C "${root}" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init`, { stdio: 'pipe' });
      execSync(`git -C "${root}" -c user.email=t@t -c user.name=t branch swarmforge-QA`, { stdio: 'pipe' });

      // Fake tmux socket so read-tmux-socket finds a valid path.
      const sockPath = path.join(root, 'fake.sock');
      fs.writeFileSync(sockPath, '');
      fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sockPath + '\n');

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
  scoped(/^a babysitter sweep runs$/, (ctx) => {
    // Fake tmux: has-session fails for every role (no sessions exist).
    const fakeBin = path.join(ctx.root, 'fake-bin');
    mkdirp(fakeBin);
    fs.writeFileSync(
      path.join(fakeBin, 'tmux'),
      '#!/usr/bin/env bash\nfor arg in "$@"; do\n  if [[ "$arg" == "has-session" ]]; then exit 1; fi\ndone\nexit 0\n'
    );
    fs.chmodSync(path.join(fakeBin, 'tmux'), 0o755);

    // Fake ps: no claude processes.
    fs.writeFileSync(
      path.join(fakeBin, 'ps'),
      '#!/usr/bin/env bash\nexit 0\n'
    );
    fs.chmodSync(path.join(fakeBin, 'ps'), 0o755);

    // Fake pgrep: no matches.
    fs.writeFileSync(
      path.join(fakeBin, 'pgrep'),
      '#!/usr/bin/env bash\nexit 1\n'
    );
    fs.chmodSync(path.join(fakeBin, 'pgrep'), 0o755);

    // Meminfo file.
    fs.writeFileSync(path.join(ctx.root, 'meminfo'), 'MemAvailable:    8000000 kB\n');

    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      BABYSITTER_MEMINFO_PATH: path.join(ctx.root, 'meminfo'),
    };

    const result = spawnSync('bash', [BABYSITTER_CHECK, ctx.root], {
      encoding: 'utf8',
      env,
    });
    if (result.status !== 0) {
      throw new Error(`babysitter_check failed (exit ${result.status}): ${result.stderr}`);
    }
    ctx.sweepOutput = result.stdout;
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^the sweep raises no pane-coordinator finding$/, (ctx) => {
    if (ctx.sweepOutput.includes('pane-coordinator')) {
      throw new Error(`expected no pane-coordinator finding, got: ${ctx.sweepOutput}`);
    }
  });

  scoped(/^the sweep repairs nothing for the coordinator$/, (ctx) => {
    // A repair for the coordinator would show up as an ensure-session
    // action targeting the coordinator role.
    if (ctx.sweepOutput.includes('coordinator') && ctx.sweepOutput.includes('ensure-session')) {
      throw new Error(`expected no coordinator repair, got: ${ctx.sweepOutput}`);
    }
  });
}

module.exports = { registerSteps };
