'use strict';

// BL-1558: step handlers for "a resident-invoked rotation keeps the
// wrapper's rotation reason". Drives the REAL handoff-lib/respawn-as! (via
// rotate_to_role.sh, the resident-invoked entry) and, separately, the REAL
// handoff-lib/rotate-resident-to! called with no explicit reason and no env
// label (the daemon's chase path, exactly as handoffd.bb calls it) against
// an isolated fixture git repo with a fake tmux binary on PATH - never a
// reimplementation of resident-rotation-reason. Same fixture shape
// test_chase_departing_mid_parcel_gate.sh uses (fixture git root under
// mkdtemp, roles.tsv, `config rotation router`, a launch script for the
// target role, SWARMFORGE_ALLOW_TMP_DAEMON=1, mono-router-active-role
// marker, an empty departing in_process so the BL-805 gate passes, and a
// parcel already in the target's inbox so wait-for-delivery! returns at
// once), per the ticket's own scenario notes.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROTATE_SH = path.join(SCRIPTS_DIR, 'rotate_to_role.sh');
const HANDOFF_LIB = path.join(SCRIPTS_DIR, 'handoff_lib.bb');

const FEATURE_NAME = "BL-1558 A resident-invoked rotation keeps the wrapper's rotation reason";

// `unset` means the variable is absent from the environment; `blank` means
// set to the empty string (ticket scenario notes) - the Scenario Outline
// handler validates every <env> example value against this explicit map,
// never a passthrough.
const KNOWN_ENV_VALUES = {
  'rotate-home': 'rotate-home',
  'rotate-forward': 'rotate-forward',
  unset: undefined,
  blank: '',
};

const HANDOFF_BODY =
  'id: x\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process coder aaaaaaaaaa\n';

function sh(cmd) {
  return execFileSync('bash', ['-c', cmd], { encoding: 'utf8' });
}

function seedFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1558-acc-');
  ctx.root = root;
  sh(`git -C ${JSON.stringify(root)} init -q`);
  sh(`git -C ${JSON.stringify(root)} -c user.email=test@test -c user.name=test commit -q --allow-empty -m init`);

  const coderWt = path.join(root, 'wt-coder');
  const cleanWt = path.join(root, 'wt-cleaner');
  ctx.coderWt = coderWt;
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
  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'cleaner.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const fakeBin = path.join(root, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'tmux'),
    '#!/usr/bin/env bash\n' +
      'echo "$*" >> "$TMUX_LOG"\n' +
      'case "$*" in\n' +
      '  *list-panes*) echo "zsh .swarmforge/launch/coder.sh" ;;\n' +
      'esac\n' +
      'exit 0\n',
    { mode: 0o755 }
  );
  ctx.fakeBin = fakeBin;
  ctx.tmuxLog = path.join(root, 'tmux-calls.log');
  fs.writeFileSync(ctx.tmuxLog, '');

  fs.writeFileSync(path.join(root, '.swarmforge', 'mono-router-active-role'), 'coder\n');

  // The target role's inbox/new already holds a parcel so
  // wait-for-delivery! (inside rotate-resident-to!) returns immediately
  // instead of polling for up to 30s.
  fs.writeFileSync(path.join(cleanWt, '.swarmforge', 'handoffs', 'inbox', 'new', '00_fwd.handoff'), HANDOFF_BODY);
}

function baseEnv(ctx) {
  return {
    ...process.env,
    PATH: `${ctx.fakeBin}:${process.env.PATH}`,
    TMUX_LOG: ctx.tmuxLog,
    SWARMFORGE_ALLOW_TMP_DAEMON: '1',
  };
}

function runResidentInvoked(ctx, envReason) {
  const env = baseEnv(ctx);
  if (envReason === undefined) {
    delete env.SWARMFORGE_ROTATION_REASON;
  } else {
    env.SWARMFORGE_ROTATION_REASON = envReason;
  }
  try {
    execFileSync('bash', [ROTATE_SH, 'cleaner'], { cwd: ctx.coderWt, env, encoding: 'utf8', stdio: 'pipe' });
    ctx.exitCode = 0;
  } catch (err) {
    ctx.exitCode = err.status;
    ctx.output = `${err.stdout || ''}${err.stderr || ''}`;
  }
}

function runDaemonPath(ctx) {
  const env = baseEnv(ctx);
  delete env.SWARMFORGE_ROTATION_REASON;
  const script = `(load-file ${JSON.stringify(HANDOFF_LIB)}) (println (handoff-lib/rotate-resident-to! "cleaner"))`;
  try {
    const out = execFileSync('bb', ['-e', script], { cwd: ctx.coderWt, env, encoding: 'utf8', stdio: 'pipe' });
    ctx.exitCode = out.includes(':ok true') ? 0 : 1;
    ctx.output = out;
  } catch (err) {
    ctx.exitCode = err.status;
    ctx.output = `${err.stdout || ''}${err.stderr || ''}`;
  }
}

function captureAndCleanup(ctx) {
  try {
    ctx.tmuxLogContent = fs.readFileSync(ctx.tmuxLog, 'utf8');
    const telemetryDir = path.join(ctx.root, '.swarmforge', 'telemetry');
    const files = fs.existsSync(telemetryDir)
      ? fs.readdirSync(telemetryDir).filter((f) => f.startsWith('rotation-') && f.endsWith('.jsonl'))
      : [];
    if (files.length === 1) {
      const lines = fs
        .readFileSync(path.join(telemetryDir, files[0]), 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        ctx.telemetryReason = JSON.parse(lines[lines.length - 1]).reason;
      }
    }
  } finally {
    if (ctx.root) {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^the resident-invoked rotation entry runs with SWARMFORGE_ROTATION_REASON (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_ENV_VALUES, raw)) {
        throw new Error(`bl1558: unrecognized <env> example value "${raw}"`);
      }
      seedFixture(ctx);
      try {
        runResidentInvoked(ctx, KNOWN_ENV_VALUES[raw]);
      } finally {
        captureAndCleanup(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the daemon's chase rotation calls the rotation core with no explicit reason and no env label$/,
    (ctx) => {
      seedFixture(ctx);
      try {
        runDaemonPath(ctx);
      } finally {
        captureAndCleanup(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the rotation succeeds$/,
    (ctx) => {
      if (ctx.exitCode !== 0 || !(ctx.tmuxLogContent || '').includes('respawn-pane')) {
        throw new Error(
          `bl1558: expected the rotation to succeed and respawn the pane, exit=${ctx.exitCode} output=${ctx.output} log=${ctx.tmuxLogContent}`
        );
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the appended rotation event carries reason (\S+)$/,
    (ctx, expectedReason) => {
      if (ctx.telemetryReason !== expectedReason) {
        throw new Error(
          `bl1558: expected the appended rotation event's reason to be "${expectedReason}", got "${ctx.telemetryReason}"`
        );
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
