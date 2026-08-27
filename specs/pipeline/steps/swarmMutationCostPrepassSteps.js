'use strict';

// BL-224: step handlers for the swarm-launcher mutation_cost pre-pass
// feature. Drives the REAL repo-root ./swarm script end to end - its own
// SCRIPT_DIR is derived from BASH_SOURCE (the script's own file location,
// not the cwd or an argument), so the real file is copied to a throwaway
// fixture root to point it there instead of the real repo. swarmforge.sh
// is replaced with a harmless stub so the final exec never launches a
// real swarm. Same fixture shape as
// swarmforge/scripts/test/test_swarm_launcher_mutation_cost_prepass.sh.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SWARM_SCRIPT = path.join(REPO_ROOT, 'swarm');

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-swarm-prepass-'));
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts', 'shared-articles'), { recursive: true });
  fs.copyFileSync(REAL_SWARM_SCRIPT, path.join(root, 'swarm'));
  fs.chmodSync(path.join(root, 'swarm'), 0o755);
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'scripts', 'swarmforge.sh'),
    '#!/usr/bin/env bash\necho "swarmforge.sh invoked with: $*"\nexit 0\n'
  );
  fs.chmodSync(path.join(root, 'swarmforge', 'scripts', 'swarmforge.sh'), 0o755);
  return root;
}

function pausedItemPath(root) {
  return path.join(root, 'backlog', 'paused', 'BL-9099.yaml');
}

function runSwarmPrepass(ctx) {
  const root = ctx.fixtureRoot;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', [path.join(root, 'swarm')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    stdout = err.stdout ? err.stdout.toString() : '';
    stderr = err.stderr ? err.stderr.toString() : '';
    ctx.spawnError = err;
  }
  ctx.stdout = stdout;
  ctx.stderr = stderr || (ctx.spawnError && ctx.spawnError.stderr ? ctx.spawnError.stderr.toString() : '');
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function registerSteps(registry) {
  // ── empty-paused-glob-01 ─────────────────────────────────────────────
  registry.define(/^backlog\/paused\/ contains no "\.yaml" files$/, (ctx) => {
    ctx.fixtureRoot = makeFixtureRoot();
  });

  registry.define(/^the swarm launcher runs its mutation_cost pre-pass$/, (ctx) => {
    runSwarmPrepass(ctx);
  });

  registry.define(/^no file named "\*\.yaml" is created in backlog\/paused\/$/, (ctx) => {
    const pausedDir = path.join(ctx.fixtureRoot, 'backlog', 'paused');
    const entries = fs.readdirSync(pausedDir);
    if (entries.includes('*.yaml')) {
      throw new Error(`expected no file literally named "*.yaml"; found: ${entries.join(', ')}`);
    }
  });

  registry.define(/^the launcher proceeds without a "No such file or directory" error on stderr$/, (ctx) => {
    if (/No such file or directory/i.test(ctx.stderr)) {
      throw new Error(`expected no glob-not-found noise on stderr; got: ${ctx.stderr}`);
    }
    if (!/swarmforge\.sh invoked/.test(ctx.stdout)) {
      throw new Error(`expected the launcher to still reach and exec swarmforge.sh; got stdout: ${ctx.stdout}`);
    }
  });

  // ── estimation-preserved-02 ──────────────────────────────────────────
  registry.define(/^backlog\/paused\/ contains a "\.yaml" item with no "mutation_cost:" field$/, (ctx) => {
    ctx.fixtureRoot = makeFixtureRoot();
    fs.writeFileSync(pausedItemPath(ctx.fixtureRoot), 'id: BL-9099\ntitle: "a small fix"\nstatus: todo\n');
  });

  registry.define(/^that item gains a "mutation_cost:" field$/, (ctx) => {
    const content = fs.readFileSync(pausedItemPath(ctx.fixtureRoot), 'utf8');
    if (!/^mutation_cost:/m.test(content)) {
      throw new Error(`expected the item to gain a mutation_cost field; got: ${content}`);
    }
  });

  // ── estimation-untouched-03 ──────────────────────────────────────────
  registry.define(/^backlog\/paused\/ contains a "\.yaml" item that already has a "mutation_cost:" field$/, (ctx) => {
    ctx.fixtureRoot = makeFixtureRoot();
    fs.writeFileSync(
      pausedItemPath(ctx.fixtureRoot),
      'id: BL-9099\ntitle: "already estimated"\nstatus: todo\nmutation_cost: high\n'
    );
    ctx.shaBefore = sha256(pausedItemPath(ctx.fixtureRoot));
  });

  registry.define(/^that item is left byte-for-byte unchanged$/, (ctx) => {
    const shaAfter = sha256(pausedItemPath(ctx.fixtureRoot));
    if (shaAfter !== ctx.shaBefore) {
      throw new Error(
        `expected the item to be byte-for-byte unchanged; got: ${fs.readFileSync(pausedItemPath(ctx.fixtureRoot), 'utf8')}`
      );
    }
  });
}

module.exports = { registerSteps };
