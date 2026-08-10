'use strict';

// BL-801: step handlers for "BL-801 shared tmp cleanup registry survives
// command-substitution registration". Drives the REAL
// swarmforge/scripts/test/lib/tmp_cleanup.sh against disposable, generated
// fixture scripts run with the host's own /bin/bash - no daemons, no
// network, no live swarm paths, no real timers (per the ticket's own
// acceptance-contract note), same idiom
// test_tmp_cleanup_lib.sh already uses and bl807/bl870's own step handlers
// use for their respective real-script/real-daemon targets. Scenario 04's
// two-process ordering uses explicit flag-file synchronization, never a
// sleep for correctness (only for polling cadence) - the ticket's own
// requirement.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib', 'tmp_cleanup.sh');

const FEATURE = 'BL-801 shared tmp cleanup registry survives command-substitution registration';

const EXIT_PATH = {
  'every assertion passes': 'pass',
  'an assertion fails after the registration': 'fail',
};
const EXPECTED_EXIT = {
  '0': 'zero',
  'non-zero': 'nonzero',
};

function knownExitPath(value) {
  if (!Object.prototype.hasOwnProperty.call(EXIT_PATH, value)) {
    throw new Error(`BL-801: unrecognized <exit-path> example value "${value}"`);
  }
  return EXIT_PATH[value];
}

function knownExpectedExit(value) {
  if (!Object.prototype.hasOwnProperty.call(EXPECTED_EXIT, value)) {
    throw new Error(`BL-801: unrecognized <expected-exit> example value "${value}"`);
  }
  return EXPECTED_EXIT[value];
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ensureState(ctx) {
  if (!ctx.bl801) {
    ctx.bl801 = {
      workdir: mkTmp('bl801-'),
      exitPathMode: null,
      lastExitCode: null,
      lastStderr: '',
      subshellRoot: null,
      directRoot: null,
      procA: null,
      procB: null,
      rootFileA: null,
      rootFileB: null,
      goFileA: null,
      goFileB: null,
      rootA: null,
      rootB: null,
    };
  }
  return ctx.bl801;
}

function cleanup(ctx) {
  const st = ctx.bl801;
  if (!st) return;
  for (const proc of [st.procA, st.procB]) {
    if (proc && proc.exitCode === null && !proc.killed) {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  if (st.workdir) fs.rmSync(st.workdir, { recursive: true, force: true });
}

function writeFixture(st, name, body) {
  const p = path.join(st.workdir, name);
  fs.writeFileSync(p, body);
  fs.chmodSync(p, 0o755);
  return p;
}

function runFixtureSync(fixturePath) {
  const result = spawnSync('bash', [fixturePath], { encoding: 'utf8' });
  return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
}

function registerSteps(registry) {
  registry.defineScoped(/^a fixture test script that sources the shared tmp cleanup lib with "set -euo pipefail" active$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  registry.defineScoped(/^the fixture's only registration happens inside a helper invoked via command substitution$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  registry.defineScoped(/^the fixture is arranged so that (.+)$/, (ctx, rawExitPath) => {
    const st = ensureState(ctx);
    st.exitPathMode = knownExitPath(rawExitPath);
  }, FEATURE);

  registry.defineScoped(/^the fixture registers no temp roots$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  registry.defineScoped(/^every assertion in the fixture passes$/, (ctx) => {
    const st = ensureState(ctx);
    st.exitPathMode = 'pass';
  }, FEATURE);

  registry.defineScoped(/^the fixture registers one temp root directly in the script body$/, (ctx) => {
    const st = ensureState(ctx);
    st.directRootRequested = true;
  }, FEATURE);

  registry.defineScoped(/^the fixture registers another temp root inside a helper invoked via command substitution$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  registry.defineScoped(/^two fixture scripts have each registered their own temp root$/, (ctx) => {
    const st = ensureState(ctx);
    st.rootFileA = path.join(st.workdir, 'root_a');
    st.goFileA = path.join(st.workdir, 'go_a');
    st.rootFileB = path.join(st.workdir, 'root_b');
    st.goFileB = path.join(st.workdir, 'go_b');

    const body = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `source "${LIB}"`,
      'ROOT="$(mktemp -d)"',
      'register_tmp_dir "$ROOT"',
      'printf \'%s\' "$ROOT" > "$1"',
      'until [[ -f "$2" ]]; do sleep 0.1; done',
      '',
    ].join('\n');
    const fixturePath = writeFixture(st, 'concurrent.sh', body);

    st.procA = spawn('bash', [fixturePath, st.rootFileA, st.goFileA], { stdio: 'ignore' });
    st.procB = spawn('bash', [fixturePath, st.rootFileB, st.goFileB], { stdio: 'ignore' });
  }, FEATURE);

  registry.defineScoped(/^the first fixture exits while the second is still running$/, async (ctx) => {
    const st = ensureState(ctx);
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if (fs.existsSync(st.rootFileA) && fs.existsSync(st.rootFileB)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    st.rootA = fs.readFileSync(st.rootFileA, 'utf8');
    st.rootB = fs.readFileSync(st.rootFileB, 'utf8');
    fs.writeFileSync(st.goFileA, '');
    await new Promise((resolve) => st.procA.on('exit', resolve));
  }, FEATURE);

  registry.defineScoped(/^the fixture exits$/, (ctx) => {
    const st = ensureState(ctx);
    let body;
    if (st.exitPathMode !== null) {
      // Scenario 01: subshell-only registration, pass or fail after it.
      body = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `source "${LIB}"`,
        'make_root() { local d; d="$(mktemp -d)"; register_tmp_dir "$d"; printf \'%s\' "$d"; }',
        'ROOT="$(make_root)"',
        'echo "ROOT=$ROOT"',
        st.exitPathMode === 'fail' ? 'false' : 'true',
        '',
      ].join('\n');
    } else if (st.directRootRequested) {
      // Scenario 03: direct + subshell registration.
      body = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `source "${LIB}"`,
        'make_root() { local d; d="$(mktemp -d)"; register_tmp_dir "$d"; printf \'%s\' "$d"; }',
        'DIRECT_ROOT="$(mktemp -d)"',
        'register_tmp_dir "$DIRECT_ROOT"',
        'SUB_ROOT="$(make_root)"',
        'echo "DIRECT=$DIRECT_ROOT"',
        'echo "SUB=$SUB_ROOT"',
        '',
      ].join('\n');
    } else {
      // Scenario 02: zero registrations.
      body = ['#!/usr/bin/env bash', 'set -euo pipefail', `source "${LIB}"`, 'echo "ALL CHECKS PASSED"', ''].join('\n');
    }

    const fixturePath = writeFixture(st, 'fixture.sh', body);
    const { stdout, stderr, code } = runFixtureSync(fixturePath);
    st.lastExitCode = code;
    st.lastStderr = stderr;
    const rootMatch = stdout.match(/^ROOT=(.+)$/m);
    if (rootMatch) st.subshellRoot = rootMatch[1];
    const directMatch = stdout.match(/^DIRECT=(.+)$/m);
    if (directMatch) st.directRoot = directMatch[1];
    const subMatch = stdout.match(/^SUB=(.+)$/m);
    if (subMatch) st.subshellRoot = subMatch[1];
  }, FEATURE);

  registry.defineScoped(/^the first fixture's cleanup runs$/, (ctx) => {
    ensureState(ctx);
    // Cleanup already ran synchronously as part of "the first fixture exits
    // while the second is still running" above (the fixture's own EXIT
    // trap fires before that step's process 'exit' event resolves).
  }, FEATURE);

  registry.defineScoped(/^the fixture's exit code is (0|non-zero)$/, (ctx, rawExpected) => {
    const st = ensureState(ctx);
    try {
      const expected = knownExpectedExit(rawExpected);
      if (expected === 'zero' && st.lastExitCode !== 0) {
        throw new Error(`BL-801: expected exit 0, got ${st.lastExitCode}`);
      }
      if (expected === 'nonzero' && st.lastExitCode === 0) {
        throw new Error('BL-801: expected a non-zero exit, got 0');
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the temp root created inside the helper no longer exists$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (!st.subshellRoot) {
        throw new Error('BL-801: fixture never printed the root it registered');
      }
      if (fs.existsSync(st.subshellRoot)) {
        throw new Error(`BL-801: root registered inside the command-substitution helper still exists: ${st.subshellRoot}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the fixture's stderr carries no "unbound variable" error$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (/unbound variable/i.test(st.lastStderr)) {
        throw new Error(`BL-801: stderr carried "unbound variable": ${st.lastStderr}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^neither temp root exists any more$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (!st.directRoot || !st.subshellRoot) {
        throw new Error('BL-801: fixture never printed both roots');
      }
      if (fs.existsSync(st.directRoot)) {
        throw new Error(`BL-801: directly registered root still exists: ${st.directRoot}`);
      }
      if (fs.existsSync(st.subshellRoot)) {
        throw new Error(`BL-801: subshell-registered root still exists: ${st.subshellRoot}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^the first fixture's temp root no longer exists$/, (ctx) => {
    const st = ensureState(ctx);
    if (fs.existsSync(st.rootA)) {
      cleanup(ctx);
      throw new Error(`BL-801: fixture A's own root still exists after its own exit: ${st.rootA}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the second fixture's temp root still exists$/, async (ctx) => {
    const st = ensureState(ctx);
    try {
      if (!fs.existsSync(st.rootB)) {
        throw new Error(`BL-801: fixture A's exit swept fixture B's still-running root: ${st.rootB}`);
      }
    } finally {
      fs.writeFileSync(st.goFileB, '');
      await new Promise((resolve) => st.procB.on('exit', resolve));
      cleanup(ctx);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
