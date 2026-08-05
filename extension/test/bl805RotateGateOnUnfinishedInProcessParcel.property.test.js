'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSharedTmpDir } = require('./helpers/tmpDir');

// BL-805 invariants (property authorship rests with the coder, first pass -
// BL-654):
//   1. "The gate blocks only resident-invoked rotation (the rotate_to_role
//      entry); daemon-initiated rotation (handoff_lib/rotate-resident-to!,
//      the path handoffd chase calls directly) is never blocked by a stuck
//      parcel."
//   2. "Only real parcels gate: a file blocks rotation only if it matches
//      the departing role's inbox/in_process/*.handoff - claim-progress
//      sidecars and any other droppings never block."
//
// Drives the REAL rotate_to_role.sh (resident-invoked entry) and
// handoff-lib/rotate-resident-to! (the daemon path, invoked exactly as
// handoffd.bb's chase sweep invokes it - directly, never through
// rotate_to_role.sh) against a disposable fixture git repo with a fake
// tmux respawn-pane logger - never a parallel reimplementation of the gate
// logic.
//
// Generator reach: SHAPES below exhaustively covers every combination the
// invariants quantify over - no handoff file present (empty / sidecars-only
// / junk-only / mixed sidecars+junk), exactly one handoff file (alone, or
// buried among sidecars+junk), and MULTIPLE handoff files at once (the gate
// must still block on multiples, and daemon rotation must still never
// block). That exhaustive dimension is never left to fast-check's random
// sampling; only the incidental dimension - how many accompanying
// sidecar/junk droppings ride along - is fuzzed per shape, and only for
// shapes where that count actually varies the fixture.
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

const SHAPES = [
  'empty',
  'sidecars-only',
  'junk-only',
  'mixed-no-handoff',
  'handoff-alone',
  'handoff-buried',
  'multiple-handoffs',
];

// numRuns per shape: 1 where extraCount can't change the fixture at all
// (nothing to fuzz), otherwise 3 - real randomization of how many
// incidental droppings ride along.
const NUM_RUNS_BY_SHAPE = {
  empty: 1,
  'sidecars-only': 3,
  'junk-only': 3,
  'mixed-no-handoff': 3,
  'handoff-alone': 1,
  'handoff-buried': 3,
  'multiple-handoffs': 1,
};

function sidecarName(idx) {
  const suffix = ['.nudge', '.chase.json', '.claim-progress.json'][idx % 3];
  return `case_sidecar${idx}.handoff${suffix}`;
}

function junkName(idx) {
  return `case_junk${idx}.txt`;
}

function handoffName(idx) {
  return `case_stuck${idx}.handoff`;
}

function buildFileList(shape, extraCount) {
  const files = [];
  switch (shape) {
    case 'empty':
      break;
    case 'sidecars-only':
      for (let i = 0; i < Math.max(1, extraCount); i++) files.push(sidecarName(i));
      break;
    case 'junk-only':
      for (let i = 0; i < Math.max(1, extraCount); i++) files.push(junkName(i));
      break;
    case 'mixed-no-handoff':
      for (let i = 0; i < Math.max(1, extraCount); i++) {
        files.push(i % 2 === 0 ? sidecarName(i) : junkName(i));
      }
      break;
    case 'handoff-alone':
      files.push(handoffName(0));
      break;
    case 'handoff-buried':
      for (let i = 0; i < extraCount; i++) {
        files.push(i % 2 === 0 ? sidecarName(i) : junkName(i));
      }
      files.push(handoffName(0));
      break;
    case 'multiple-handoffs':
      files.push(handoffName(0), handoffName(1));
      break;
    default:
      throw new Error(`BL-805 property test: unknown shape "${shape}"`);
  }
  return files;
}

function expectedBlocking(shape) {
  return shape === 'handoff-alone' || shape === 'handoff-buried' || shape === 'multiple-handoffs';
}

function materializeInProcess(dir, fileNames) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fileNames) {
    fs.writeFileSync(path.join(dir, name), name.endsWith('.handoff') ? HANDOFF_BODY : '{}');
  }
}

function makeFixture() {
  const root = mkSharedTmpDir('bl805-prop-');
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

  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));

  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'cleaner.sh'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(root, '.swarmforge', 'launch', 'cleaner.sh'), 0o755);

  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'tmux'), '#!/usr/bin/env bash\necho "$*" >> "$TMUX_LOG"\nexit 0\n');
  fs.chmodSync(path.join(binDir, 'tmux'), 0o755);

  // cleaner's inbox/new already holds the just-forwarded parcel so
  // wait-for-delivery! (inside rotate-resident-to!) returns immediately
  // instead of polling for up to 30s.
  fs.writeFileSync(
    path.join(cleanWt, '.swarmforge', 'handoffs', 'inbox', 'new', '00_fwd.handoff'),
    HANDOFF_BODY
  );

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

test(
  'property (invariant 1): daemon-initiated rotation is never blocked by a stuck parcel, for every shape of in_process contents',
  () => {
    const fx = makeFixture();
    for (const shape of SHAPES) {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 4 }), (extraCount) => {
          const files = buildFileList(shape, extraCount);
          materializeInProcess(fx.inProcessDir, files);
          resetMarkerAndLog(fx);
          const res = runDaemonPath(fx);
          assert.ok(
            res.out.includes(':ok true'),
            `shape=${shape} extraCount=${extraCount}: expected rotate-resident-to! to succeed regardless of in_process contents, in_process=${JSON.stringify(files)}, got: ${res.out}`
          );
          assert.ok(
            res.respawned,
            `shape=${shape} extraCount=${extraCount}: daemon path never called tmux respawn-pane despite in_process=${JSON.stringify(files)}`
          );
        }),
        { numRuns: NUM_RUNS_BY_SHAPE[shape] }
      );
    }
  },
  120000
);

test(
  "property (invariant 2): only a real *.handoff file in the departing role's in_process ever gates resident-invoked rotation",
  () => {
    const fx = makeFixture();
    for (const shape of SHAPES) {
      const blocked = expectedBlocking(shape);
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 4 }), (extraCount) => {
          const files = buildFileList(shape, extraCount);
          materializeInProcess(fx.inProcessDir, files);
          resetMarkerAndLog(fx);
          const res = runResidentInvoked(fx);
          if (blocked) {
            assert.notEqual(
              res.status,
              0,
              `shape=${shape} extraCount=${extraCount}: expected refusal, in_process=${JSON.stringify(files)}, got exit ${res.status}: ${res.out}`
            );
            assert.match(
              res.out,
              /done_with_current\.sh/i,
              `shape=${shape}: refusal must name done_with_current.sh, got: ${res.out}`
            );
            assert.ok(
              !res.respawned,
              `shape=${shape} extraCount=${extraCount}: pane must not respawn on refusal, in_process=${JSON.stringify(files)}`
            );
          } else {
            assert.equal(
              res.status,
              0,
              `shape=${shape} extraCount=${extraCount}: expected rotation to proceed (no real parcel present), in_process=${JSON.stringify(files)}, got exit ${res.status}: ${res.out}`
            );
            assert.ok(
              res.respawned,
              `shape=${shape} extraCount=${extraCount}: expected a respawn-pane call, in_process=${JSON.stringify(files)}`
            );
          }
        }),
        { numRuns: NUM_RUNS_BY_SHAPE[shape] }
      );
    }
  },
  180000
);
