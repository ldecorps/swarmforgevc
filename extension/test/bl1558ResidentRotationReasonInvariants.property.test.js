'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSharedTmpDir } = require('./helpers/tmpDir');

// BL-1558 invariant (property authorship rests with the coder, first pass -
// BL-654): "A resident-invoked rotation's telemetry reason is the wrapper's
// non-blank SWARMFORGE_ROTATION_REASON when set and handoff-forward
// otherwise; a daemon-driven rotation's reason stays rotate; the label
// never decides where the rotation goes or whether it happens."
//
// Drives the REAL rotate_to_role.sh -> rotate_to_role.bb ->
// handoff-lib/respawn-as! (the resident-invoked path) and, separately, the
// REAL handoff-lib/rotate-resident-to! called with no explicit reason and
// no env label (the daemon's chase path, exactly as handoffd.bb calls it) -
// never a parallel reimplementation of resident-rotation-reason.
//
// Generator reach: SHAPES below exhaustively covers every label-producing
// class the invariant quantifies over - the env var absent entirely, blank
// (empty string), whitespace-only, the wrapper's two known labels
// (rotate-home, rotate-forward) each with incidental surrounding
// whitespace, and an ARBITRARY non-blank label (proving the pass-through is
// not secretly special-cased to only the two known literals). That
// exhaustive dimension is never left to fast-check's random sampling; only
// the incidental content (the fuzzed whitespace/arbitrary string) is
// sampled per shape.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROTATE_SH = path.join(SCRIPTS, 'rotate_to_role.sh');
const HANDOFF_LIB = path.join(SCRIPTS, 'handoff_lib.bb');
const BB_BIN = execFileSync('bash', ['-lc', 'command -v bb'], { encoding: 'utf8' }).trim();
const GIT_BIN = execFileSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).trim();

const HANDOFF_BODY =
  'id: x\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process coder aaaaaaaaaa\n';

const SHAPES = ['unset', 'blank', 'whitespace-only', 'rotate-home', 'rotate-forward', 'arbitrary-nonblank'];

const NUM_RUNS_BY_SHAPE = {
  unset: 1,
  blank: 1,
  'whitespace-only': 3,
  'rotate-home': 3,
  'rotate-forward': 3,
  'arbitrary-nonblank': 5,
};

// A non-empty, non-whitespace, single-line printable-ASCII string - env var
// values travel through spawnSync's env object (never a shell), so the only
// real constraint is "no embedded newline" (a rotation reason is one line).
const nonBlankLabel = fc
  .string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0 && !s.includes('\n'));

const whitespaceOnly = fc
  .array(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(''));

function padded(label) {
  return fc.tuple(whitespaceOnly, whitespaceOnly).map(([pre, post]) => `${pre}${label}${post}`);
}

function envGenForShape(shape) {
  switch (shape) {
    case 'unset':
      return fc.constant(undefined);
    case 'blank':
      return fc.constant('');
    case 'whitespace-only':
      return whitespaceOnly;
    case 'rotate-home':
      return padded('rotate-home');
    case 'rotate-forward':
      return padded('rotate-forward');
    case 'arbitrary-nonblank':
      return nonBlankLabel;
    default:
      throw new Error(`BL-1558 property test: unknown shape "${shape}"`);
  }
}

function expectedReason(shape, envReason) {
  if (shape === 'unset' || shape === 'blank' || shape === 'whitespace-only') return 'handoff-forward';
  return String(envReason).trim();
}

function makeFixture() {
  const root = mkSharedTmpDir('bl1558-prop-');
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

  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config rotation router\n');

  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));

  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'cleaner.sh'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(root, '.swarmforge', 'launch', 'cleaner.sh'), 0o755);

  // Same fake-tmux shape bl805's property fixture uses: list-panes answers
  // with the departing role's own launch script (coder is always the
  // resident here, matching the fixed marker below) so the live-identity
  // probe resolves and departing-role-blocking-handoff never fails open,
  // and every other tmux call just logs and exits 0.
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
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

  fs.writeFileSync(path.join(root, '.swarmforge', 'mono-router-active-role'), 'coder\n');

  return {
    root,
    coderWt,
    binDir,
    tmuxLog: path.join(root, 'tmux-calls.log'),
    inProcessDir: path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
    cleanerNewDir: path.join(cleanWt, '.swarmforge', 'handoffs', 'inbox', 'new'),
    telemetryDir: path.join(root, '.swarmforge', 'telemetry'),
  };
}

function reset(fx) {
  fs.writeFileSync(path.join(fx.root, '.swarmforge', 'mono-router-active-role'), 'coder\n');
  fs.writeFileSync(fx.tmuxLog, '');
  // Clear in_process (BL-805 gate must always pass for this ticket's own
  // scenarios) and re-seed cleaner's inbox/new so wait-for-delivery!
  // returns immediately instead of polling up to 30s.
  fs.rmSync(fx.inProcessDir, { recursive: true, force: true });
  fs.mkdirSync(fx.inProcessDir, { recursive: true });
  fs.rmSync(fx.cleanerNewDir, { recursive: true, force: true });
  fs.mkdirSync(fx.cleanerNewDir, { recursive: true });
  fs.writeFileSync(path.join(fx.cleanerNewDir, '00_fwd.handoff'), HANDOFF_BODY);
  fs.rmSync(fx.telemetryDir, { recursive: true, force: true });
}

function readTmuxLog(fx) {
  return fs.readFileSync(fx.tmuxLog, 'utf8');
}

function lastTelemetryReason(fx) {
  const files = fs.existsSync(fx.telemetryDir)
    ? fs.readdirSync(fx.telemetryDir).filter((f) => f.startsWith('rotation-') && f.endsWith('.jsonl'))
    : [];
  assert.equal(files.length, 1, `expected exactly one rotation telemetry file, found: ${JSON.stringify(files)}`);
  const lines = fs
    .readFileSync(path.join(fx.telemetryDir, files[0]), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  assert.ok(lines.length >= 1, 'expected at least one telemetry line');
  return JSON.parse(lines[lines.length - 1]).reason;
}

function runResidentInvoked(fx, envReason) {
  const env = { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}`, TMUX_LOG: fx.tmuxLog };
  if (envReason === undefined) {
    delete env.SWARMFORGE_ROTATION_REASON;
  } else {
    env.SWARMFORGE_ROTATION_REASON = envReason;
  }
  const result = spawnSync('bash', [ROTATE_SH, 'cleaner'], {
    cwd: fx.coderWt,
    encoding: 'utf8',
    env,
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
  const env = { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}`, TMUX_LOG: fx.tmuxLog };
  delete env.SWARMFORGE_ROTATION_REASON;
  const result = spawnSync(BB_BIN, ['-e', script], {
    cwd: fx.coderWt,
    encoding: 'utf8',
    env,
    timeout: 15000,
  });
  return {
    status: result.status,
    out: (result.stdout || '') + (result.stderr || ''),
    respawned: readTmuxLog(fx).includes('respawn-pane'),
  };
}

test(
  'property: a resident-invoked rotation labels the telemetry reason with the wrapper\'s non-blank env value, or handoff-forward otherwise, and always rotates regardless',
  () => {
    const fx = makeFixture();
    for (const shape of SHAPES) {
      fc.assert(
        fc.property(envGenForShape(shape), (envReason) => {
          reset(fx);
          const res = runResidentInvoked(fx, envReason);
          assert.equal(
            res.status,
            0,
            `shape=${shape} env=${JSON.stringify(envReason)}: expected the rotation to succeed regardless of the label, got exit ${res.status}: ${res.out}`
          );
          assert.ok(
            res.respawned,
            `shape=${shape} env=${JSON.stringify(envReason)}: expected tmux respawn-pane to be called (the label never decides whether the rotation happens)`
          );
          const reason = lastTelemetryReason(fx);
          assert.equal(
            reason,
            expectedReason(shape, envReason),
            `shape=${shape} env=${JSON.stringify(envReason)}: unexpected telemetry reason`
          );
        }),
        { numRuns: NUM_RUNS_BY_SHAPE[shape] }
      );
    }
  },
  180000
);

test(
  'property: the daemon-driven chase rotation (no explicit reason, no env label) always keeps the rotate default',
  () => {
    const fx = makeFixture();
    reset(fx);
    const res = runDaemonPath(fx);
    assert.equal(res.status, 0, `expected the daemon path to succeed, got: ${res.out}`);
    assert.ok(res.respawned, 'expected tmux respawn-pane to be called');
    assert.equal(lastTelemetryReason(fx), 'rotate', 'daemon-driven rotation must keep the rotate default');
  },
  30000
);
