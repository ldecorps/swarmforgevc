'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { waitForFileSync, describeWaitTimeout } = require('./helpers/waitForFileSync');

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
// BL-1063: these shapes are now APPENDED to a constructed farm rather than
// used as the caller PATH outright, so they still vary the hostile-noise
// dimension they were written for while no longer deciding whether node
// resolves. They are not appended to the node-less half, for the obvious
// reason: every one of them contains /usr/bin, which is exactly what must not
// be there.
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

// BL-1063: whether the CALLER's own PATH already resolves node. This is the
// dimension the property was missing, and its absence is what made the old
// assertion host-dependent: every generated PATH above contains /usr/bin, so
// on a host with /usr/bin/node the caller always resolved node and the nvm
// fallback was never reached - while the assertion demanded the nvm tree
// anyway, and failed because operator_path_lib.sh correctly refused to shadow
// the caller's node (BL-796 invariant 3).
//
// Crossing it explicitly reaches BOTH branches by construction rather than by
// luck about what the host has installed, which is the whole point: the same
// verdict on a host that carries a system node and one that does not.
const callerResolvesNodeArb = fc.boolean();

// A caller PATH with every ordinary command on it EXCEPT node - so node
// genuinely does not resolve, and the nvm fallback must answer.
//
// Built by symlinking the real search path rather than by curating a list of
// "the commands these scripts need": a curated list is a guess that goes stale
// silently, and the failure it produces (a script dying on a missing binary)
// looks nothing like the thing under test. Built ONCE and reused - it is the
// same farm every run, and 900-odd symlinks per generated case is a cost with
// no benefit.
let nodelessPathCache = null;
function nodelessCallerPath() {
  if (nodelessPathCache) return nodelessPathCache;
  const dir = mkTmpDir('bl796-prop-nodeless-');
  const seen = new Set();
  for (const sourceDir of ['/usr/bin', '/bin']) {
    let entries;
    try {
      entries = fs.readdirSync(sourceDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node' || name === 'nodejs' || seen.has(name)) continue;
      seen.add(name);
      try {
        fs.symlinkSync(path.join(sourceDir, name), path.join(dir, name));
      } catch {
        /* a name that already exists, or an unreadable entry - neither matters */
      }
    }
  }
  // The premise, asserted rather than assumed: this PATH must genuinely fail to
  // resolve node, or the "does not resolve" half of the property is vacuous.
  const probe = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8', env: { PATH: dir } });
  assert.notEqual(probe.status, 0, `the node-less caller PATH still resolves node: ${probe.stdout.trim()}`);
  nodelessPathCache = dir;
  return dir;
}

// BL-1063 (architect bounce D1): the MIRROR of the farm above, and the reason
// it has to exist.
//
// The first pass built a deterministic farm for the "does not resolve" half
// and then wrote `/usr/bin:/bin` for the "resolves" half, as though that
// literal deterministically carries node. Whether it does is itself a HOST
// FACT - true here, false on the nvm-only box the original test was written
// on - so the fix bound the opposite host fact into the assertion and
// reintroduced this ticket's own defect, inverted. On a host with no system
// node it fails with a wrong-looking assertion rather than a clear one.
//
// So the caller's node is a STUB WE PLACE, on top of the node-less farm so
// every other command still resolves. The assertion can then compare against a
// known path instead of querying a literal that may or may not answer, and no
// premise check is needed at all - there is nothing left to assume.
let callerNodeCache = null;
function callerNodePath() {
  if (callerNodeCache) return callerNodeCache;
  const dir = mkTmpDir('bl796-prop-callernode-');
  const stub = path.join(dir, 'node');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(stub, 0o755);
  const callerPath = `${dir}:${nodelessCallerPath()}`;
  const probe = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8', env: { PATH: callerPath } });
  assert.equal(probe.stdout.trim(), stub, 'the caller-resolves farm must resolve node to its own stub');
  callerNodeCache = { callerPath, stub };
  return callerNodeCache;
}

test(
  'property (invariant 1): the launched daemon inherits a PATH on which both bb and node resolve, however minimal the caller PATH',
  () => {
    fc.assert(
      fc.property(callerPathArb, aliasArb, callerResolvesNodeArb, (generatedPath, useAlias, callerResolvesNode) => {
        // BL-1063: BOTH halves are deterministic farms now. The generated
        // "minimal caller PATH" shapes still vary the hostile-noise dimension
        // the property was written for - they are appended to the farm rather
        // than used raw, so the noise is exercised without the host deciding
        // whether node resolves.
        const caller = callerResolvesNode ? callerNodePath() : null;
        const callerPath = caller ? `${caller.callerPath}:${generatedPath}` : nodelessCallerPath();
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
          // BL-1063: the daemon is BACKGROUNDED, so spawnSync returning says
          // nothing about whether the child has run. Wait for its marker under
          // a bounded deadline, returning the moment both lines are there -
          // reading it on the next line was a race, and waiting on mere
          // existence would be a subtler one, since the child writes through a
          // shell redirect and the file appears before its contents do.
          const marker = waitForFileSync(resolvedLog, {
            timeoutMs: 10000,
            ready: (text) => text.trim().split('\n').filter(Boolean).length === 2,
          });
          assert.ok(
            marker.ok,
            `${describeWaitTimeout(resolvedLog, 10000, 'the launched daemon never reported its resolved binaries')} (caller PATH="${callerPath}")`
          );
          const resolved = marker.contents.trim();
          const lines = resolved.split('\n');
          assert.equal(lines.length, 2, `expected both bb and node to resolve (caller PATH="${callerPath}"), got:\n${resolved}`);
          assert.equal(lines[0], stub, `expected bb resolved as "${stub}", got: ${lines[0]}`);
          // BL-1063: the invariant is that node RESOLVES, not where from. The
          // old assertion demanded the fake nvm tree unconditionally, which is
          // a claim about which branch answered - and on any host with a system
          // node it is the branch operator_path_lib.sh is REQUIRED not to take
          // (BL-796 invariant 3: a binary the caller's PATH already resolves is
          // never shadowed). So the test was red exactly because production was
          // correct.
          //
          // Each branch is still checked, by the dimension that decides it:
          const nvmTree = path.join(home, '.nvm', 'versions', 'node');
          assert.ok(
            fs.existsSync(lines[1]),
            `expected node to resolve to a real path (caller PATH="${callerPath}"), got: ${lines[1]}`
          );
          if (callerResolvesNode) {
            // The caller had one, so the caller's own must have won - compared
            // against the stub we PLACED, not against a live `command -v node`
            // query whose answer is a fact about the host (architect bounce D1).
            assert.equal(
              lines[1],
              caller.stub,
              `expected the caller's own node ("${caller.stub}") to be used unshadowed (caller PATH="${callerPath}"), got: ${lines[1]}`
            );
            assert.ok(
              !lines[1].startsWith(nvmTree),
              `the nvm fallback must never shadow a node the caller already resolves, got: ${lines[1]}`
            );
            // BL-1063 (architect bounce D1), made permanent: the caller's node
            // is the stub this test PLACED, never one the host happens to
            // carry. Before the mirror farm existed this row resolved
            // /usr/bin/node on hosts that have it and failed outright on hosts
            // that do not - the host fact this ticket exists to unbind.
            assert.ok(
              !lines[1].startsWith('/usr/'),
              `the caller's node must be this test's own stub, not a host installation: ${lines[1]}`
            );
          } else {
            // The caller had none, so the fallback must have supplied one.
            assert.ok(
              lines[1].startsWith(nvmTree),
              `with node unresolvable on the caller PATH, expected the nvm fallback to supply it, got: ${lines[1]}`
            );
          }
        } finally {
          killPid(hdPid);
          killPid(supPid);
        }
      }),
      // BL-1063: raised from 10 with the third dimension added, so both the
      // caller-resolves and nvm-fallback halves are reached many times rather
      // than a handful.
      { numRuns: 16 }
    );
  },
  120000
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
