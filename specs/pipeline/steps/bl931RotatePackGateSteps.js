'use strict';

// BL-931: step handlers for "a pack without rotation router never has a
// standing pane respawned as another role". Drives the REAL
// swarmforge/scripts/rotate_to_role.sh and handoff_lib.bb (absolute paths,
// load-file/cd are not relative to this file) against an isolated fixture
// git repo with a fake tmux binary on PATH - never a reimplementation of
// the gate's decision logic. Same fixture shape as
// test_rotate_pack_router_gate.sh (BL-931's own real-fixture shell test),
// reproduced here in JS because the feature names this file as its step
// handler.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROTATE_SH = path.join(SCRIPTS_DIR, 'rotate_to_role.sh');
const HANDOFF_LIB = path.join(SCRIPTS_DIR, 'handoff_lib.bb');

const FEATURE_NAME = 'a pack without rotation router never has a standing pane respawned as another role';

const KNOWN_ROTATION_MODES = {
  'config rotation router': true,
  'no rotation line': false,
};

const KNOWN_OUTCOMES = {
  proceed: 'proceed',
  'refuse-not-router': 'refuse-not-router',
};

const FAKE_TMUX_SCRIPT = `#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
exit 0
`;

function sh(cmd) {
  return execFileSync('bash', ['-c', cmd], { encoding: 'utf8' });
}

function seedFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl931-acceptance-'));
  ctx.root = root;
  sh(`git -C ${JSON.stringify(root)} init -q`);
  sh(`git -C ${JSON.stringify(root)} -c user.email=test@test -c user.name=test commit -q --allow-empty -m init`);

  const specWt = path.join(root, 'wt-specifier');
  const coderWt = path.join(root, 'wt-coder');
  ctx.specWt = specWt;
  ctx.coderWt = coderWt;
  for (const dir of [
    path.join(specWt, '.swarmforge', 'handoffs', 'inbox', 'new'),
    path.join(specWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
    path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'),
    path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
    path.join(root, '.swarmforge', 'launch'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${specWt}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'coder.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'specifier.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // coder's inbox already holds a parcel so rotate-resident-to!'s
  // wait-for-delivery! returns immediately instead of polling 30s.
  fs.writeFileSync(
    path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new', '00_fwd.handoff'),
    'id: fwd\nfrom: specifier\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process specifier aaaaaaaaaa\n'
  );

  ctx.markerFile = path.join(root, '.swarmforge', 'mono-router-active-role');
  fs.writeFileSync(ctx.markerFile, 'specifier');

  const fakeBin = path.join(root, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const tmuxPath = path.join(fakeBin, 'tmux');
  fs.writeFileSync(tmuxPath, FAKE_TMUX_SCRIPT, { mode: 0o755 });
  ctx.fakeBin = fakeBin;
  ctx.tmuxLog = path.join(root, 'tmux-calls.log');
  fs.writeFileSync(ctx.tmuxLog, '');
}

function writeConf(ctx, isRouter) {
  const confDir = path.join(ctx.root, 'swarmforge');
  fs.mkdirSync(confDir, { recursive: true });
  const confPath = path.join(confDir, 'swarmforge.conf');
  if (isRouter) {
    fs.writeFileSync(confPath, 'config rotation router\n');
  } else if (fs.existsSync(confPath)) {
    fs.unlinkSync(confPath);
  }
}

function runResidentRotate(ctx) {
  const env = {
    ...process.env,
    PATH: `${ctx.fakeBin}:${process.env.PATH}`,
    TMUX_LOG: ctx.tmuxLog,
  };
  if (ctx.forceOverride) {
    env.SWARMFORGE_ROTATE_FORCE = '1';
  } else {
    delete env.SWARMFORGE_ROTATE_FORCE;
  }
  try {
    const out = execFileSync('bash', [ROTATE_SH, 'coder'], { cwd: ctx.specWt, env, encoding: 'utf8', stdio: 'pipe' });
    ctx.exitCode = 0;
    ctx.output = out;
  } catch (err) {
    ctx.exitCode = err.status;
    ctx.output = `${err.stdout || ''}${err.stderr || ''}`;
  }
}

function runDaemonRotate(ctx) {
  const env = {
    ...process.env,
    PATH: `${ctx.fakeBin}:${process.env.PATH}`,
    TMUX_LOG: ctx.tmuxLog,
  };
  const script = `(load-file ${JSON.stringify(HANDOFF_LIB)}) (println (handoff-lib/rotate-resident-to! "coder"))`;
  const out = execFileSync('bb', ['-e', script], { cwd: ctx.specWt, env, encoding: 'utf8', stdio: 'pipe' });
  ctx.daemonExitCode = 0;
  ctx.daemonOutput = out;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a swarm whose roles\.tsv lists a pipeline role before the coordinator$/,
    (ctx) => {
      seedFixture(ctx);
    },
    FEATURE_NAME
  );

  // ── shared Givens ────────────────────────────────────────────────────
  registry.defineScoped(
    /^the pack declares (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_ROTATION_MODES, raw)) {
        throw new Error(`bl931: unrecognized <rotation mode> example value "${raw}"`);
      }
      writeConf(ctx, KNOWN_ROTATION_MODES[raw]);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the first pipeline row in roles\.tsv is a standing specifier pane$/,
    () => {
      // Already established by the Background's fixture (specifier is
      // roles.tsv row 1) - this Given names the shape, nothing to arrange.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the rotate force override is set$/,
    (ctx) => {
      ctx.forceOverride = true;
    },
    FEATURE_NAME
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the resident rotate helper is invoked for another role$/,
    (ctx) => {
      runResidentRotate(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the handoff daemon invokes the rotate helper directly$/,
    (ctx) => {
      runDaemonRotate(ctx);
    },
    FEATURE_NAME
  );

  // ── rotate-pack-gate-01 ──────────────────────────────────────────────
  registry.defineScoped(
    /^the rotation outcome is "(.+)"$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_OUTCOMES, raw)) {
        throw new Error(`bl931: unrecognized <outcome> example value "${raw}"`);
      }
      const expected = KNOWN_OUTCOMES[raw];
      if (ctx.daemonOutput !== undefined) {
        const refused = ctx.daemonOutput.includes(':ok false') && ctx.daemonOutput.includes('not-a-rotation-router');
        const actual = refused ? 'refuse-not-router' : 'proceed';
        if (actual !== expected) {
          throw new Error(`bl931: expected daemon-path outcome "${expected}", got: ${ctx.daemonOutput}`);
        }
        return;
      }
      const tmuxLogContent = fs.readFileSync(ctx.tmuxLog, 'utf8');
      if (expected === 'proceed') {
        if (ctx.exitCode !== 0 || !tmuxLogContent.includes('respawn-pane')) {
          throw new Error(`bl931: expected the rotation to proceed, exit=${ctx.exitCode} output=${ctx.output} log=${tmuxLogContent}`);
        }
      } else {
        if (ctx.exitCode === 0 || !/does not rotate/i.test(ctx.output)) {
          throw new Error(`bl931: expected a pack refusal, exit=${ctx.exitCode} output=${ctx.output}`);
        }
      }
    },
    FEATURE_NAME
  );

  // ── rotate-pack-gate-02 ──────────────────────────────────────────────
  registry.defineScoped(
    /^no pane is respawned$/,
    (ctx) => {
      const tmuxLogContent = fs.readFileSync(ctx.tmuxLog, 'utf8');
      if (tmuxLogContent.trim() !== '') {
        throw new Error(`bl931: expected no tmux command at all, log: ${tmuxLogContent}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the standing specifier pane is still running the specifier launch script$/,
    (ctx) => {
      // No respawn-pane call was ever issued (proven by the prior step), so
      // the pane's own live process (out of this fixture's reach - the
      // fake tmux never actually runs anything) was never touched at all.
      // What IS provable here: the specifier launch script itself is
      // untouched on disk, and the pane's session name was never a target
      // of any tmux command.
      const tmuxLogContent = fs.readFileSync(ctx.tmuxLog, 'utf8');
      if (tmuxLogContent.includes('swarmforge-specifier')) {
        throw new Error(`bl931: the standing specifier pane's session was addressed by a tmux command, log: ${tmuxLogContent}`);
      }
      const scriptPath = path.join(ctx.root, '.swarmforge', 'launch', 'specifier.sh');
      if (!fs.existsSync(scriptPath)) {
        throw new Error('bl931: the specifier launch script itself must still exist, untouched');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the active-role marker is unchanged$/,
    (ctx) => {
      const marker = fs.readFileSync(ctx.markerFile, 'utf8').trim();
      if (marker !== 'specifier') {
        throw new Error(`bl931: expected the active-role marker to stay "specifier", got: "${marker}"`);
      }
    },
    FEATURE_NAME
  );

  // ── rotate-pack-gate-03 ──────────────────────────────────────────────
  registry.defineScoped(
    /^the refusal names the pack rather than a parcel$/,
    (ctx) => {
      if (!/does not rotate/i.test(ctx.output)) {
        throw new Error(`bl931: refusal must name the pack, got: ${ctx.output}`);
      }
      if (/unfinished parcel|in_process/i.test(ctx.output)) {
        throw new Error(`bl931: refusal must not read as the unrelated stuck-parcel gate, got: ${ctx.output}`);
      }
    },
    FEATURE_NAME
  );

  // ── rotate-pack-gate-04 ──────────────────────────────────────────────
  registry.defineScoped(
    /^the caller receives a result it can read rather than a process exit$/,
    (ctx) => {
      // runDaemonRotate itself would have thrown (a nonzero bb exit, e.g.
      // an uncaught exception or System/exit) had the daemon-path caller
      // died instead of returning - reaching this step at all is part of
      // the proof. The printed result must also be a readable map, not a
      // bare stack trace.
      if (ctx.daemonExitCode !== 0) {
        throw new Error('bl931: the daemon-path caller must exit 0, printing a result map, never a process exit');
      }
      if (!/:ok\s+false/.test(ctx.daemonOutput)) {
        throw new Error(`bl931: expected a readable {:ok false ...} result map, got: ${ctx.daemonOutput}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
