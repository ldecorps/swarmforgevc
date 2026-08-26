'use strict';

// BL-947: step handlers for "swarmforge.sh reports failures on stderr".
// Scenarios 01/02 drive the REAL launcher end-to-end against a throwaway
// working dir whose control socket path overruns the unix-socket limit -
// the launcher exits at the refusal before starting anything, so the run
// is safe and side-effect-free. Scenario 04 drives the exact resolution
// command substitution the launcher performs (project_socket_id_lib.sh +
// resolve_swarm_socket.bb, the same pair swarmforge.sh composes). Scenario
// 03 drives the shared scanner in lib/swarmforgeShErrorChannel.js - never
// a reimplementation of any of it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { scanScriptFile } = require('./lib/swarmforgeShErrorChannel');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LAUNCHER = path.join(SCRIPTS_DIR, 'swarmforge.sh');

const FEATURE = 'swarmforge.sh reports failures on stderr';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

// /tmp directly, never os.tmpdir(): macOS's real /var/folders/... base plus
// a fixture prefix plus /.swarmforge/tmux/<hash>.sock overruns the ~100-char
// sun_path limit by itself, which would turn the WITHIN-limit fixture into
// an over-limit one (the exact trap BL-944's regression testing hit).
function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join('/tmp', prefix));
  trackedRoots.push(root);
  return root;
}

function launcherEnv() {
  // XDG_RUNTIME_DIR removed so the resolver's fallback branch cannot rescue
  // an over-limit primary path - the refusal is what scenarios 01/02 need.
  const env = { ...process.env };
  delete env.XDG_RUNTIME_DIR;
  return env;
}

function projectSocketId(workingDir) {
  return execFileSync('bash', ['-c', `source "${SCRIPTS_DIR}/project_socket_id_lib.sh"; project_socket_id "$1"`, 'bash', workingDir], {
    encoding: 'utf8',
  }).trim();
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the launcher script swarmforge\.sh$/,
    (ctx) => {
      ctx.launcher = LAUNCHER;
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a working directory whose control socket path exceeds the limit$/,
    (ctx) => {
      const base = mkTmp('sfvc-bl947-long-');
      const deep = path.join(base, 'x'.repeat(40), 'y'.repeat(40), 'work');
      fs.mkdirSync(deep, { recursive: true });
      ctx.workingDir = deep;
    },
    FEATURE
  );

  registry.defineScoped(
    /^a working directory whose control socket path is within the limit$/,
    (ctx) => {
      ctx.workingDir = mkTmp('sfvc-bl947-ok-');
    },
    FEATURE
  );

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the launcher resolves the control socket$/,
    (ctx) => {
      // The real launcher, streams captured SEPARATELY (never merged - the
      // whole ticket is about which channel carries what). For the
      // over-limit fixture it exits at the refusal; for the within-limit
      // fixture it proceeds past resolution and dies later at the missing
      // config - either way nothing is launched and the fixture is a
      // tracked throwaway.
      const run = spawnSync('zsh', [ctx.launcher, ctx.workingDir], {
        encoding: 'utf8',
        env: launcherEnv(),
        timeout: 30000,
      });
      ctx.run = { exitCode: run.status ?? 1, stdout: run.stdout || '', stderr: run.stderr || '' };

      // The exact resolution substitution the launcher performs at its
      // TMUX_SOCKET= line: same hash derivation, same bb resolver.
      const id = projectSocketId(ctx.workingDir);
      const sub = spawnSync('bb', [path.join(SCRIPTS_DIR, 'resolve_swarm_socket.bb'), ctx.workingDir, id], {
        encoding: 'utf8',
        env: launcherEnv(),
        timeout: 15000,
      });
      ctx.expectedSocketPath = path.join(ctx.workingDir, '.swarmforge', 'tmux', `${id}.sock`);
      ctx.substitution = { exitCode: sub.status ?? 1, stdout: sub.stdout || '', stderr: sub.stderr || '' };
    },
    FEATURE
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the refusal text appears on stderr$/,
    (ctx) => {
      assert.match(ctx.run.stderr, /unix-socket path limit/, `expected the refusal on stderr, got stderr:\n${ctx.run.stderr}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^stdout carries no part of the refusal text$/,
    (ctx) => {
      assert.ok(!/unix-socket path limit|Error:/.test(ctx.run.stdout), `expected no refusal text on stdout, got:\n${ctx.run.stdout}`);
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the message names the unix-socket path limit as the reason$/,
    (ctx) => {
      // Invariant 2: the specific reason survives the channel change - the
      // limit, the offending path, and its measured length all still named.
      assert.match(ctx.run.stderr, /unix-socket path limit \(\d+ chars\)/);
      assert.ok(ctx.run.stderr.includes(ctx.workingDir), `expected the offending path on stderr, got:\n${ctx.run.stderr}`);
      assert.match(ctx.run.stderr, /\(\d+ chars\)\s*$/m);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the launcher exits non-zero$/,
    (ctx) => {
      assert.notEqual(ctx.run.exitCode, 0);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^every error-reporting line in the script is inspected$/,
    (ctx) => {
      ctx.violations = scanScriptFile(ctx.launcher);
    },
    FEATURE
  );

  registry.defineScoped(
    /^each one writes to stderr$/,
    (ctx) => {
      assert.deepEqual(
        ctx.violations,
        [],
        `expected every error line on stderr, found stdout offenders:\n${ctx.violations
          .map((v) => `line ${v.line}: ${v.text}`)
          .join('\n')}`
      );
    },
    FEATURE
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^stdout carries the socket path and nothing else$/,
    (ctx) => {
      assert.equal(ctx.substitution.exitCode, 0, `expected the resolution to succeed, stderr:\n${ctx.substitution.stderr}`);
      assert.equal(ctx.substitution.stdout, `${ctx.expectedSocketPath}\n`);
      // And the launcher's own stdout through the same stretch carries no
      // stray diagnostic that would corrupt a command substitution.
      assert.equal(ctx.run.stdout, '', `expected an empty launcher stdout, got:\n${ctx.run.stdout}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
