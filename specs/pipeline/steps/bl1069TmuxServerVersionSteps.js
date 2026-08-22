'use strict';

// BL-1069: step handlers for "the swarm judges its tmux by the server it is
// actually running".
//
// Every scenario drives the REAL landed code - the functions inside
// swarmforge/scripts/swarmforge.sh, control_plane_lib.bb's harden-server!,
// and swarmforge/scripts/install_tmux_wsl.sh - as subprocesses, against a
// fake `tmux` on PATH that answers the version (or the rejection) the row is
// about. No real tmux server is ever started and nothing here restates a
// version rule.
//
// The shell functions run under `zsh -f`: swarmforge.sh is a zsh script, and
// -f skips rc files because ~/.zshenv on this host re-exports real provider
// credentials over fixture values (a launcher probe leaked a live key that
// way on 2026-08-22). Nothing below prints an environment dump either way.
//
// The fake tmux is `#!/bin/sh` with shell builtins only: scenario 02 narrows
// PATH to almost nothing so a row saying "no tmux on PATH" is not quietly
// satisfied by the host's own /usr/bin/tmux, and a fake needing `env` or
// `bash` found on PATH would fail for a reason the scenario is not about.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const FEATURE = 'BL-1069 the swarm judges its tmux by the server it is actually running';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const INSTALLER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'install_tmux_wsl.sh');
const CONTROL_PLANE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'control_plane_lib.bb');

// Explicit known values per the Scenario Outline handler rule: a row the
// handlers do not know is a hard failure, never a passthrough.
const KNOWN_VERDICTS = new Set(['warned', 'silent']);
const KNOWN_CHOICES = new Set(['local', 'path']);
const KNOWN_OPTIONS = new Set(['focus-events', 'window-size', 'both']);
const KNOWN_OBSTACLES = new Set([
  'the host architecture has no build',
  'the downloaded build fails its digest',
]);
// "none" is a version row meaning the server does not answer / no tmux is
// there at all, not a version string.
const ABSENT = new Set(['none', 'absent']);

let trackedPaths = [];
afterEach(() => {
  while (trackedPaths.length) {
    fs.rmSync(trackedPaths.pop(), { recursive: true, force: true });
  }
});

function newRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1069-'));
  trackedPaths.push(root);
  return root;
}

// A tmux that answers `-V` as a client and `display-message -p '#{version}'`
// as a server. serverVersion "none" means no server answers.
function writeFakeTmux(target, clientVersion, serverVersion) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    [
      '#!/bin/sh',
      'if [ "${1:-}" = "-V" ]; then',
      `  echo "tmux ${clientVersion}"`,
      '  exit 0',
      'fi',
      'if [ "${3:-}" = "display-message" ]; then',
      ...(ABSENT.has(serverVersion) ? ['  exit 1'] : [`  echo "${serverVersion}"`, '  exit 0']),
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
}

// A tmux that rejects the named set-option(s) and accepts everything else -
// what an older build does with a knob it does not know.
function writeRejectingTmux(target, option) {
  const rejected = option === 'both' ? ['focus-events', 'window-size'] : [option];
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    [
      '#!/bin/sh',
      'for arg in "$@"; do',
      `  case "$arg" in`,
      `    ${rejected.join('|')})`,
      '      echo "unknown option: $arg" >&2',
      '      exit 1',
      '      ;;',
      '  esac',
      'done',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
}

function zshSourced(snippet, env, extraPath) {
  const result = spawnSync(
    'zsh',
    ['-f', '-c', `source '${SWARMFORGE_SH}' '${REPO_ROOT}' >/dev/null 2>&1 || true\n${snippet}`],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env, PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH },
    }
  );
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenario 01: the verdict is read from the server ────────────────────

  scoped(/^the tmux client on PATH reports "(.+)"$/, (ctx, client) => {
    assert.ok(fs.existsSync(SWARMFORGE_SH), `the launcher under test is missing: ${SWARMFORGE_SH}`);
    ctx.root = newRoot();
    ctx.clientVersion = client;
  });

  scoped(/^the control-plane server on the swarm socket reports "(.+)"$/, (ctx, server) => {
    assert.ok(ctx.root, 'no client was established before the server');
    ctx.serverVersion = server;
    writeFakeTmux(path.join(ctx.root, 'bin', 'tmux'), ctx.clientVersion, server);
  });

  scoped(/^the swarm checks its tmux version$/, (ctx) => {
    ctx.output = zshSourced("warn_if_tmux_too_old '/fake/swarm/socket'", {}, path.join(ctx.root, 'bin'));
  });

  scoped(/^the operator is "(.+)"$/, (ctx, verdict) => {
    assert.ok(
      KNOWN_VERDICTS.has(verdict),
      `unknown verdict "${verdict}" - the handlers know ${[...KNOWN_VERDICTS].join(', ')}`
    );
    const warned = /WARN/.test(ctx.output);
    assert.equal(warned, verdict === 'warned', `output was: ${JSON.stringify(ctx.output)}`);
    if (!warned) {
      return;
    }
    // The whole point of the fix: it reports what it MEASURED. With a server
    // answering, that is the server's version and never the client's.
    if (!ABSENT.has(ctx.serverVersion)) {
      assert.ok(
        ctx.output.includes('the control-plane server'),
        `the warning does not say it measured the server: ${ctx.output}`
      );
      assert.ok(
        ctx.output.includes(ctx.serverVersion),
        `the warning does not quote the server version it measured: ${ctx.output}`
      );
    }
  });

  // ── scenario 02: preference never lowers the version ────────────────────

  scoped(/^a tmux at "~\/\.local\/bin\/tmux" reporting "(.+)"$/, (ctx, local) => {
    ctx.root = newRoot();
    ctx.home = path.join(ctx.root, 'home');
    ctx.pathBin = path.join(ctx.root, 'path-bin');
    // PATH is narrowed to the fixture plus the one external tool these
    // functions use, so an "absent"/"none" row cannot be satisfied by the
    // host's own tmux.
    ctx.sandbox = path.join(ctx.root, 'sandbox-bin');
    fs.mkdirSync(path.join(ctx.home, '.local', 'bin'), { recursive: true });
    fs.mkdirSync(ctx.pathBin, { recursive: true });
    fs.mkdirSync(ctx.sandbox, { recursive: true });
    fs.symlinkSync(execFileSync('sh', ['-c', 'command -v sed'], { encoding: 'utf8' }).trim(), path.join(ctx.sandbox, 'sed'));
    ctx.localTmux = path.join(ctx.home, '.local', 'bin', 'tmux');
    if (!ABSENT.has(local)) {
      writeFakeTmux(ctx.localTmux, local, 'none');
    }
  });

  scoped(/^a tmux earlier on PATH reporting "(.+)"$/, (ctx, onPath) => {
    assert.ok(ctx.root, 'no local tmux was established first');
    ctx.pathTmux = path.join(ctx.pathBin, 'tmux');
    if (!ABSENT.has(onPath)) {
      writeFakeTmux(ctx.pathTmux, onPath, 'none');
    }
  });

  scoped(/^the swarm resolves which tmux to launch with$/, (ctx) => {
    ctx.output = zshSourced(
      [`PATH='${ctx.pathBin}:${ctx.sandbox}'`, 'prefer_local_tmux_bin', 'command -v tmux 2>/dev/null || echo NONE'].join(
        '\n'
      ),
      { HOME: ctx.home }
    ).trim();
  });

  scoped(/^it launches with the "(.+)" tmux$/, (ctx, chosen) => {
    assert.ok(
      KNOWN_CHOICES.has(chosen),
      `unknown choice "${chosen}" - the handlers know ${[...KNOWN_CHOICES].join(', ')}`
    );
    const expected = chosen === 'local' ? ctx.localTmux : ctx.pathTmux;
    assert.equal(ctx.output, expected, `resolved tmux was ${JSON.stringify(ctx.output)}`);
  });

  // ── scenario 03: a rejected stability knob never fails the caller ───────

  scoped(/^a live control plane whose tmux rejects the "(.+)" option$/, (ctx, option) => {
    assert.ok(
      KNOWN_OPTIONS.has(option),
      `unknown option "${option}" - the handlers know ${[...KNOWN_OPTIONS].join(', ')}`
    );
    ctx.root = newRoot();
    ctx.option = option;
    ctx.incidents = path.join(ctx.root, 'incidents.edn');
    writeRejectingTmux(path.join(ctx.root, 'bin', 'tmux'), option);
  });

  scoped(/^the swarm hardens the server during an ensure$/, (ctx) => {
    // Both halves of the landed hardening, because the ensure path runs both:
    // the shell one on launch, and control_plane_lib's on a plane restore and
    // when the plane is already up.
    ctx.shellOutput = zshSourced(
      ['set -e', "TMUX_SOCKET='/fake/swarm/socket'", 'harden_tmux_server', 'echo ENSURE_CONTINUED'].join('\n'),
      {},
      path.join(ctx.root, 'bin')
    );
    const bb = spawnSync(
      'bb',
      [
        '-e',
        `(load-file "${CONTROL_PLANE_LIB}") (control-plane-lib/harden-server! "/fake/swarm/socket") (println "ENSURE_CONTINUED")`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${path.join(ctx.root, 'bin')}:${process.env.PATH}` },
      }
    );
    ctx.bbStatus = bb.status;
    ctx.bbOutput = `${bb.stdout || ''}${bb.stderr || ''}`;
  });

  scoped(/^the ensure still reports the control plane up$/, (ctx) => {
    assert.ok(
      ctx.shellOutput.includes('ENSURE_CONTINUED'),
      `the launcher's hardening aborted its caller: ${ctx.shellOutput}`
    );
    assert.equal(ctx.bbStatus, 0, `control_plane_lib's hardening failed the ensure: ${ctx.bbOutput}`);
    assert.ok(
      ctx.bbOutput.includes('ENSURE_CONTINUED'),
      `control_plane_lib's hardening aborted its caller: ${ctx.bbOutput}`
    );
  });

  scoped(/^the rejection is not recorded as a control-plane failure$/, (ctx) => {
    assert.equal(
      fs.existsSync(ctx.incidents),
      false,
      'a rejected stability knob opened a control-plane incident'
    );
    for (const output of [ctx.shellOutput, ctx.bbOutput]) {
      assert.doesNotMatch(
        output,
        /control-plane.*(fail|incident|down)/i,
        `a rejected knob was reported as a control-plane failure: ${output}`
      );
    }
  });

  // ── scenario 04: the installer verifies or refuses by name ──────────────

  scoped(/^the install script is asked for a build it cannot verify because "(.+)"$/, (ctx, obstacle) => {
    assert.ok(
      KNOWN_OBSTACLES.has(obstacle),
      `unknown obstacle "${obstacle}" - the handlers know ${[...KNOWN_OBSTACLES].join('; ')}`
    );
    assert.ok(fs.existsSync(INSTALLER), `the installer under test is missing: ${INSTALLER}`);
    ctx.root = newRoot();
    ctx.obstacle = obstacle;
    ctx.home = path.join(ctx.root, 'home');
    ctx.installedTmux = path.join(ctx.home, '.local', 'bin', 'tmux');
    fs.mkdirSync(ctx.home, { recursive: true });

    // A REAL tarball served over file:// - the same curl path a real run
    // takes, so nothing about the download is stubbed out.
    const pkg = path.join(ctx.root, 'pkg', 'tmux-3.7b');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'tmux'), '#!/bin/sh\necho "tmux 3.7b"\n', { mode: 0o755 });
    ctx.tarball = path.join(ctx.root, 'tmux.tgz');
    execFileSync('tar', ['-czf', ctx.tarball, '-C', path.join(ctx.root, 'pkg'), 'tmux-3.7b']);
    const realDigest = crypto.createHash('sha256').update(fs.readFileSync(ctx.tarball)).digest('hex');

    ctx.env = { HOME: ctx.home, TMUX_INSTALL_URL: `file://${ctx.tarball}` };
    if (obstacle === 'the downloaded build fails its digest') {
      // A digest that is well-formed and simply not this build's.
      ctx.env.TMUX_INSTALL_SHA256 = realDigest.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    } else {
      ctx.env.TMUX_INSTALL_SHA256 = realDigest;
      // An architecture with no published build, reported by a uname first
      // on PATH - the real `uname -m` call, a different answer.
      const bin = path.join(ctx.root, 'bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho riscv64\n', { mode: 0o755 });
      ctx.extraPath = bin;
    }
  });

  scoped(/^the install script runs$/, (ctx) => {
    const result = spawnSync('bash', [INSTALLER], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...ctx.env,
        PATH: ctx.extraPath ? `${ctx.extraPath}:${process.env.PATH}` : process.env.PATH,
      },
    });
    ctx.exit = result.status;
    ctx.output = `${result.stdout || ''}${result.stderr || ''}`;
  });

  scoped(/^no tmux is left at "~\/\.local\/bin\/tmux"$/, (ctx) => {
    assert.notEqual(ctx.exit, 0, `the installer succeeded where it should have refused: ${ctx.output}`);
    assert.equal(
      fs.existsSync(ctx.installedTmux),
      false,
      'the installer left a binary behind after refusing - a half-install is worse than none'
    );
  });

  scoped(/^it refuses with a reason naming "(.+)"$/, (ctx, obstacle) => {
    assert.ok(KNOWN_OBSTACLES.has(obstacle), `unknown obstacle "${obstacle}"`);
    assert.match(ctx.output, /refusing/i, `the installer did not say it was refusing: ${ctx.output}`);
    // Named, not merely non-zero: the operator has to know WHICH obstacle.
    const marker =
      obstacle === 'the host architecture has no build' ? /architecture has no build/i : /fails its digest/i;
    assert.match(ctx.output, marker, `the refusal does not name "${obstacle}": ${ctx.output}`);
  });
}

module.exports = { registerSteps };
