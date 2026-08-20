'use strict';

// BL-936: step handlers for "the BL-805 rotation-gate property lane
// exercises the parcel gate, not the pack gate". Scenario 01 runs the REAL
// property file as a real subprocess on the real property lane - the only
// way to prove the lane itself is green, not merely that the gate logic
// is correct in isolation. Scenario 02 drives the same two real call paths
// (rotate_to_role.sh, handoff-lib/rotate-resident-to!) against a fixture
// built fresh here rather than importing the property file's own
// makeFixture() - the ticket's own constraint keeps that fixture
// self-contained and local, so this file has its own, independently
// declaring the same rotation-router pack for the same reason.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'the BL-805 rotation-gate property lane exercises the parcel gate, not the pack gate';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROTATE_SH = path.join(SCRIPTS, 'rotate_to_role.sh');
const HANDOFF_LIB = path.join(SCRIPTS, 'handoff_lib.bb');
const PROPERTY_FILE_REL = 'test/bl805RotateGateOnUnfinishedInProcessParcel.property.test.js';
const BB_BIN = execFileSync('bash', ['-lc', 'command -v bb'], { encoding: 'utf8' }).trim();
const GIT_BIN = execFileSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).trim();

const HANDOFF_BODY =
  'id: x\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process coder aaaaaaaaaa\n';

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const ENTRY_VALUES = new Set(['resident-invoked', 'daemon']);
const CONTENTS_VALUES = new Set(['a real unfinished parcel', 'only sidecars and junk']);
const OUTCOME_VALUES = new Set(['is refused, naming done_with_current.sh', 'proceeds and respawns the pane']);

function parseKnown(set, token, label) {
  if (!set.has(token)) {
    throw new Error(`unknown ${label} token: ${token}`);
  }
  return token;
}

function cleanupFixture(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
}

function guarded(fn) {
  return async (ctx, ...args) => {
    try {
      return await fn(ctx, ...args);
    } catch (err) {
      cleanupFixture(ctx);
      throw err;
    }
  };
}

function terminal(fn) {
  return async (ctx, ...args) => {
    try {
      return await fn(ctx, ...args);
    } finally {
      cleanupFixture(ctx);
    }
  };
}

// ── Scenario 02's own fixture (self-contained, not shared with the
// property file - same shape, same BL-936 rotation-router declaration and
// list-panes-aware fake tmux, for the same reasons documented at length in
// the property file itself) ─────────────────────────────────────────────

function mkFixture() {
  const root = mkSocketFixtureRoot('sfvc-bl936-');
  execFileSync(GIT_BIN, ['-C', root, 'init', '-q']);
  execFileSync(GIT_BIN, ['-C', root, 'config', 'user.email', 'test@test']);
  execFileSync(GIT_BIN, ['-C', root, 'config', 'user.name', 'test']);
  execFileSync(GIT_BIN, ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init']);

  const coderWt = path.join(root, 'wt-coder');
  const cleanWt = path.join(root, 'wt-cleaner');
  for (const dir of [
    path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'),
    path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
    path.join(cleanWt, '.swarmforge', 'handoffs', 'inbox', 'new'),
    path.join(cleanWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
    path.join(root, '.swarmforge', 'launch'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `cleaner\tcleaner\t${cleanWt}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`
  );

  // BL-936: declares the pack a rotation router (BL-931's gate), same conf
  // route the sibling shell fixture and the property file both use.
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config rotation router\n');

  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));

  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'cleaner.sh'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(root, '.swarmforge', 'launch', 'cleaner.sh'), 0o755);

  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  // BL-936: answers list-panes so departing-role-blocking-handoff's
  // BL-927 live-identity confirmation resolves to "coder" (the fixed
  // departing role here) instead of failing open - see the property
  // file's own comment at its identical fake tmux for the full mechanism.
  fs.writeFileSync(
    path.join(binDir, 'tmux'),
    '#!/usr/bin/env bash\n' +
      'echo "$*" >> "$TMUX_LOG"\n' +
      'case "$*" in\n' +
      '  *list-panes*) echo "zsh .swarmforge/launch/coder.sh" ;;\n' +
      'esac\n' +
      'exit 0\n'
  );
  fs.chmodSync(path.join(binDir, 'tmux'), 0o755);

  fs.writeFileSync(path.join(cleanWt, '.swarmforge', 'handoffs', 'inbox', 'new', '00_fwd.handoff'), HANDOFF_BODY);

  return {
    root,
    coderWt,
    binDir,
    markerPath: path.join(root, '.swarmforge', 'mono-router-active-role'),
    tmuxLog: path.join(root, 'tmux-calls.log'),
    inProcessDir: path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
  };
}

function resetMarkerAndLog(fx) {
  fs.writeFileSync(fx.markerPath, 'coder\n');
  fs.writeFileSync(fx.tmuxLog, '');
}

function readTmuxLog(fx) {
  return fs.readFileSync(fx.tmuxLog, 'utf8');
}

function materializeInProcess(dir, fileNames) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fileNames) {
    fs.writeFileSync(path.join(dir, name), name.endsWith('.handoff') ? HANDOFF_BODY : '{}');
  }
}

function filesForContents(contents) {
  if (contents === 'a real unfinished parcel') {
    return ['case_stuck.handoff'];
  }
  return ['case_sidecar.handoff.nudge', 'case_junk.txt'];
}

function runResidentInvoked(fx) {
  const result = spawnSync('bash', [ROTATE_SH, 'cleaner'], {
    cwd: fx.coderWt,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}`, TMUX_LOG: fx.tmuxLog },
    timeout: 15000,
  });
  return {
    status: result.status,
    out: (result.stdout || '') + (result.stderr || ''),
    respawned: readTmuxLog(fx).includes('respawn-pane'),
  };
}

function runDaemonPath(fx) {
  const script = `(load-file "${HANDOFF_LIB}") (println (handoff-lib/rotate-resident-to! "cleaner"))`;
  const result = spawnSync(BB_BIN, ['-e', script], {
    cwd: fx.coderWt,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}`, TMUX_LOG: fx.tmuxLog },
    timeout: 15000,
  });
  return {
    status: result.status,
    out: (result.stdout || '') + (result.stderr || ''),
    respawned: readTmuxLog(fx).includes('respawn-pane'),
  };
}

function registerSteps(registry) {
  // ── Scenario 01: the real property file is green on the property lane ───
  registry.defineScoped(
    /^the BL-805 rotation-gate property file$/,
    (ctx) => {
      ctx.propertyFileRel = PROPERTY_FILE_REL;
    },
    FEATURE
  );

  registry.defineScoped(
    /^it is run on the property lane$/,
    (ctx) => {
      const result = spawnSync(
        'npx',
        ['vitest', 'run', '--config', 'vitest.properties.config.mjs', ctx.propertyFileRel],
        { cwd: EXTENSION_DIR, encoding: 'utf8', timeout: 90000 }
      );
      ctx.laneResult = { status: result.status, out: (result.stdout || '') + (result.stderr || '') };
    },
    FEATURE
  );

  registry.defineScoped(
    /^both of its properties pass$/,
    (ctx) => {
      assert.equal(ctx.laneResult.status, 0, `expected the property lane run to exit 0, got: ${ctx.laneResult.out}`);
      assert.match(ctx.laneResult.out, /2 passed/, `expected "2 passed" in the lane output, got: ${ctx.laneResult.out}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no failure cites a refusal to rotate the pack$/,
    (ctx) => {
      assert.doesNotMatch(ctx.laneResult.out, /not-a-rotation-router/);
      assert.doesNotMatch(ctx.laneResult.out, /does not rotate/);
    },
    FEATURE
  );

  // ── Scenario 02 (Outline): the unfinished-parcel gate decides each entry ─
  registry.defineScoped(
    /^a BL-805-shaped rotation fixture whose pack declares that it rotates$/,
    guarded((ctx) => {
      ctx.fixture = mkFixture();
      ctx.root = ctx.fixture.root;
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the departing role's in_process box holds (.+)$/,
    guarded((ctx, token) => {
      const contents = parseKnown(CONTENTS_VALUES, token, 'contents');
      materializeInProcess(ctx.fixture.inProcessDir, filesForContents(contents));
      resetMarkerAndLog(ctx.fixture);
    }),
    FEATURE
  );

  registry.defineScoped(
    /^rotation is driven through the (.+) entry$/,
    terminal((ctx, token) => {
      const entry = parseKnown(ENTRY_VALUES, token, 'entry');
      ctx.result = entry === 'daemon' ? runDaemonPath(ctx.fixture) : runResidentInvoked(ctx.fixture);
    }),
    FEATURE
  );

  registry.defineScoped(
    /^the rotation (.+)$/,
    (ctx, token) => {
      const outcome = parseKnown(OUTCOME_VALUES, token, 'outcome');
      if (outcome === 'is refused, naming done_with_current.sh') {
        assert.notEqual(ctx.result.status, 0, `expected a refusal, got exit ${ctx.result.status}: ${ctx.result.out}`);
        assert.match(ctx.result.out, /done_with_current\.sh/i, `expected the refusal to name done_with_current.sh, got: ${ctx.result.out}`);
        assert.ok(!ctx.result.respawned, 'expected no respawn-pane call on refusal');
      } else {
        assert.equal(ctx.result.status, 0, `expected rotation to proceed, got exit ${ctx.result.status}: ${ctx.result.out}`);
        assert.ok(ctx.result.respawned, 'expected a respawn-pane call');
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
