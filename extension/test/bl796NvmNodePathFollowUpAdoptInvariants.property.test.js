'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-796 invariants (property authorship rests with the coder, first pass -
// BL-654). Drives the REAL swarmforge/scripts/operator_path_lib.sh and
// start_handoff_daemon.sh against real filesystem fixtures - never a
// parallel reimplementation. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SWARMFORGE_SCRIPTS, 'operator_path_lib.sh');
const START_SCRIPT = path.join(SWARMFORGE_SCRIPTS, 'start_handoff_daemon.sh');

function makeFakeNvmHome() {
  const home = mkTmpDir('bl796-prop-home-');
  const versionsDir = path.join(home, '.nvm', 'versions', 'node');
  for (const v of ['v9.11.2', 'v22.1.0']) {
    const binDir = path.join(versionsDir, v, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(binDir, 'node'), 0o755);
  }
  return home;
}

function makeStubNamed(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(p, 0o755);
  return p;
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(Number(pid), 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function readPidIfPresent(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

// ── Invariant 1 ──────────────────────────────────────────────────────────
// "Every daemon these scripts launch inherits a PATH on which both bb and
// node resolve, however minimal the caller's PATH was."
//
// Generator reach: crosses several "minimal cron-like" caller PATH shapes
// (never missing /usr/bin:/bin - the pre-existing POSIX-sh bootstrap floor
// any invoker, cron included, actually has - a totally empty PATH would
// make even dirname/cd/pwd unresolvable before any PATH-fixing code could
// run at all, a bootstrap constraint pre-existing this ticket, not a
// caller-PATH scenario cron actually produces) AND whether an nvm default
// alias exists, so the property holds regardless of hostile PATH noise and
// regardless of which nvm-resolution branch (alias vs newest-by-version)
// answers the launch.
const callerPathArb = fc.constantFrom(
  '/usr/bin:/bin',
  '/nonexistent-dir-xyz:/usr/bin:/bin',
  '/usr/bin:/bin:/nonexistent-dir-xyz:/also-nonexistent'
);
const aliasArb = fc.boolean();

test(
  'property (invariant 1): the launched daemon inherits a PATH on which both bb and node resolve, however minimal the caller PATH',
  () => {
    fc.assert(
      fc.property(callerPathArb, aliasArb, (callerPath, useAlias) => {
        const root = mkTmpDir('bl796-prop-root-');
        fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
        const home = makeFakeNvmHome();
        if (useAlias) {
          fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true });
          fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), 'v9.11.2\n');
        }

        const fakeBbDir = path.join(root, 'fake-bb');
        const stub = path.join(fakeBbDir, 'bb');
        const resolvedLog = path.join(root, 'resolved.log');
        fs.mkdirSync(fakeBbDir, { recursive: true });
        fs.writeFileSync(
          stub,
          [
            '#!/bin/sh',
            'script="$1"',
            'root="$2"',
            'daemon_dir="$root/.swarmforge/daemon"',
            'case "$script" in',
            '  *supervisor*) echo $$ > "$daemon_dir/handoffd-supervisor.pid" ;;',
            '  *)',
            `    { command -v bb; command -v node; } > "${resolvedLog}" 2>&1 || true`,
            '    echo $$ > "$daemon_dir/handoffd.pid"',
            '    ;;',
            'esac',
            'sleep 3',
            '',
          ].join('\n')
        );
        fs.chmodSync(stub, 0o755);

        const result = spawnSync('bash', [START_SCRIPT, root], {
          encoding: 'utf8',
          timeout: 20000,
          env: {
            PATH: `${fakeBbDir}:${callerPath}`,
            HOME: home,
            HANDOFFD_BB: path.join(root, 'fake-handoffd.bb'),
            HANDOFFD_SUPERVISOR_BB: path.join(root, 'fake-handoffd-supervisor.bb'),
          },
        });

        const hdPid = readPidIfPresent(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'));
        const supPid = readPidIfPresent(path.join(root, '.swarmforge', 'daemon', 'handoffd-supervisor.pid'));
        try {
          assert.equal(result.status, 0, `start_handoff_daemon.sh exited nonzero (caller PATH="${callerPath}"): ${result.stderr}`);
          assert.equal(fs.existsSync(resolvedLog), true, `expected the launched daemon to have run at all (caller PATH="${callerPath}")`);
          const resolved = fs.readFileSync(resolvedLog, 'utf8').trim();
          const lines = resolved.split('\n');
          assert.equal(lines.length, 2, `expected both bb and node to resolve (caller PATH="${callerPath}"), got:\n${resolved}`);
          assert.equal(lines[0], stub, `expected bb resolved as "${stub}", got: ${lines[0]}`);
          assert.ok(
            lines[1].includes(path.join(home, '.nvm', 'versions', 'node')),
            `expected node resolved from the fake nvm tree (caller PATH="${callerPath}"), got: ${lines[1]}`
          );
        } finally {
          killPid(hdPid);
          killPid(supPid);
        }
      }),
      { numRuns: 10 }
    );
  },
  60000
);

// ── Invariant 2 ──────────────────────────────────────────────────────────
// "Sourcing the PATH lib changes nothing but PATH — no working-directory,
// shell-option, or other environment mutation leaks into the sourcing
// script."
//
// Generator reach: crosses whether an nvm default alias exists AND whether
// a decoy bb sits on the search path - different combinations drive
// swarmforge_prepend_operator_bins through different internal branches
// (direct command -v hit vs the nvm fallback; bb found vs not) while the
// "only PATH changes" guarantee must hold across all of them, not just the
// simplest no-op case.
const invariant2Arb = fc.record({ useAlias: fc.boolean(), addDecoyBb: fc.boolean() });

test('property (invariant 2): sourcing operator_path_lib.sh and prepending mutates only PATH', () => {
  fc.assert(
    fc.property(invariant2Arb, ({ useAlias, addDecoyBb }) => {
      const home = makeFakeNvmHome();
      if (useAlias) {
        fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true });
        fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), 'v22.1.0\n');
      }
      const scratchRoot = mkTmpDir('bl796-prop-inv2-');
      const beforeEnv = path.join(scratchRoot, 'before.env');
      const afterEnv = path.join(scratchRoot, 'after.env');
      const beforePwd = path.join(scratchRoot, 'before.pwd');
      const afterPwd = path.join(scratchRoot, 'after.pwd');
      const beforeOpts = path.join(scratchRoot, 'before.opts');
      const afterOpts = path.join(scratchRoot, 'after.opts');

      let searchPath = '/usr/bin:/bin';
      if (addDecoyBb) {
        const decoyDir = path.join(scratchRoot, 'decoy-bb');
        makeStubNamed(decoyDir, 'bb');
        searchPath = `${decoyDir}:${searchPath}`;
      }

      const script = [
        `env | sort | grep -v '^PATH=' > "${beforeEnv}"`,
        `pwd > "${beforePwd}"`,
        `set -o > "${beforeOpts}"`,
        `. "${LIB}"`,
        'swarmforge_prepend_operator_bins',
        `env | sort | grep -v '^PATH=' > "${afterEnv}"`,
        `pwd > "${afterPwd}"`,
        `set -o > "${afterOpts}"`,
      ].join('\n');

      const result = spawnSync('sh', ['-c', script], {
        encoding: 'utf8',
        timeout: 10000,
        env: { PATH: searchPath, HOME: home },
      });
      assert.equal(result.status, 0, `sourcing failed (useAlias=${useAlias}, addDecoyBb=${addDecoyBb}): ${result.stderr}`);

      assert.equal(
        fs.readFileSync(beforeEnv, 'utf8'),
        fs.readFileSync(afterEnv, 'utf8'),
        `expected no env var other than PATH to change (useAlias=${useAlias}, addDecoyBb=${addDecoyBb})`
      );
      assert.equal(
        fs.readFileSync(beforePwd, 'utf8'),
        fs.readFileSync(afterPwd, 'utf8'),
        `expected the working directory to be unchanged (useAlias=${useAlias}, addDecoyBb=${addDecoyBb})`
      );
      assert.equal(
        fs.readFileSync(beforeOpts, 'utf8'),
        fs.readFileSync(afterOpts, 'utf8'),
        `expected shell options to be unchanged (useAlias=${useAlias}, addDecoyBb=${addDecoyBb})`
      );
    }),
    { numRuns: 10 }
  );
});

// ── Invariant 3 ──────────────────────────────────────────────────────────
// "A binary the caller's PATH already resolves is never shadowed by a
// different installation the helpers discover."
//
// Generator reach: crosses BOTH binaries the lib resolves (bb via a direct
// command -v hit; node via the same direct hit OR the nvm fallback - the
// property holds either way) AND the caller-resolvable copy's position
// within a multi-dir caller PATH (front/middle/back), while a decoy of the
// SAME binary name sits in a curated fallback dir (~/.local/bin) and, for
// node, the fake nvm tree ALSO has a real answer - two independent shadow
// sources the caller's own resolution must still win over.
const binaryArb = fc.constantFrom('bb', 'node');
const positionArb = fc.constantFrom('front', 'middle', 'back');

test('property (invariant 3): a binary already resolvable on the caller PATH is never shadowed by a different discovered installation', () => {
  fc.assert(
    fc.property(binaryArb, positionArb, (binary, position) => {
      const home = makeFakeNvmHome(); // a second, independent shadow source for "node"
      makeStubNamed(path.join(home, '.local', 'bin'), binary); // curated-fallback-dir shadow source, for either binary

      const decoyA = mkTmpDir('bl796-prop-decoyA-');
      const decoyB = mkTmpDir('bl796-prop-decoyB-');
      const callerDir = mkTmpDir('bl796-prop-callerdir-');
      const callerStub = makeStubNamed(callerDir, binary);

      const dirsByPosition = {
        front: [callerDir, decoyA, decoyB],
        middle: [decoyA, callerDir, decoyB],
        back: [decoyA, decoyB, callerDir],
      };
      const callerPath = `${dirsByPosition[position].join(':')}:/usr/bin:/bin`;

      const result = spawnSync('sh', ['-c', `. "${LIB}"; swarmforge_prepend_operator_bins; command -v ${binary}`], {
        encoding: 'utf8',
        timeout: 10000,
        env: { PATH: callerPath, HOME: home },
      });
      assert.equal(result.status, 0, `resolution failed (binary=${binary}, position=${position}): ${result.stderr}`);
      assert.equal(
        result.stdout.trim(),
        callerStub,
        `expected the caller's own ${binary} ("${callerStub}") to win at position=${position}, got: ${result.stdout.trim()}`
      );
    }),
    { numRuns: 12 }
  );
});
