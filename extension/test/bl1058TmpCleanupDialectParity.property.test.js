// BL-1058 property test (coder-authored, two DECLARED invariants).
//
//   Invariant 1: "The tmp-cleanup helper behaves identically under BSD/macOS
//   and GNU/Linux mktemp: the registry is created, and every registered
//   fixture root is swept on both the clean-exit and the failed-command path.
//   No single platform's mktemp dialect appears in the call."
//
//   Invariant 2: "Sourcing the helper never leaves a shell partially
//   initialized. Either the registry variable names a usable file, or the
//   source fails loud with an error naming the tmp-cleanup registry as what
//   could not be created - never a state where a later register_tmp_dir hits
//   an unbound variable."
//
// Invariant 1 is an EQUIVALENCE between two userlands, so a property that
// runs a generated program under one mktemp proves nothing: the defect was
// precisely that everything passed under the authoring host's mktemp. Each
// generated program is therefore run TWICE - once with a GNU-only mktemp
// first on PATH, once with a BSD-only one - and the two observations are
// compared to each other as well as to the invariant. Both shims come from
// swarmforge/scripts/test/lib/mktemp_dialect_shim.sh, the same file the shell
// unit suite and the BL-1058 acceptance steps drive, so no lane can end up
// modelling a userland the others do not.
//
// Invariant 2 is a DISJUNCTION, which is why an ordinary test misses half of
// it: a suite that only ever sees mktemp succeed never observes the failing
// branch at all, and the branch is where the "unbound variable somewhere else
// entirely" failure lived. Its generator therefore varies mktemp between
// working and unusable (a refusing shim, and a TMPDIR that does not exist -
// never chmod, per the engineering rules' failure-simulation ban) and asserts
// that EVERY draw lands on exactly one side of the disjunction.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Both generators build their axes by CONSTRUCTION rather than drawing them
// independently and hoping: invariant 1 draws registration counts including
// zero and nesting depths above 1 explicitly, and invariant 2 enumerates the
// full mktemp-availability cross-product instead of sampling it, so the
// failing branch cannot be a rare draw. Floors below assert each reached
// state was in fact reached.
//
// RUN COUNT: each draw is a real bash subprocess (~20ms), and invariant 1
// spends two per draw. The default is sized so the whole file stays inside
// this lane's 20s per-test timeout with room to spare rather than copying the
// 300 other property files use over pure functions.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break applied to
// swarmforge/scripts/test/lib/tmp_cleanup.sh and then restored:
//
//   mktemp -t <prefix>              (the shipped defect) .. invariant 1 FAILS
//   mktemp --tmpdir <prefix>.XXXXXX (the mirror defect) .. invariant 1 FAILS
//   the fail-loud branch replaced by a bare `exit 1` ..... invariant 2 FAILS
//
// The third row is the one worth recording: with the guard reduced to a bare
// exit the sourcing script still stops, so any assertion that only checked
// "did it keep going" stays green. Invariant 2 fails there only because it
// asserts the error NAMES the registry - which is the whole of the invariant's
// second clause, and the half a status-code check cannot see.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TEST_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib');
const HELPER = path.join(TEST_LIB, 'tmp_cleanup.sh');
const SHIM_WRITER = path.join(TEST_LIB, 'mktemp_dialect_shim.sh');

const PARITY_RUNS = Number(process.env.PROPERTY_RUNS || 40);

// The one call form BOTH userlands accept, so a generated program's own
// scaffolding can never be what decides which dialect passes.
const MAKE_ROOT = 'mktemp -d "$TMPDIR/bl1058-root.XXXXXX"';

function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

// A sandbox holds one dialect's shim and its own TMPDIR, so a run's registry
// and every fixture root land under a root the shared BL-420 sweep reclaims.
function newSandbox(dialect, { tmpdir = 'ok' } = {}) {
  const root = mkTmpDir('sfvc-bl1058-prop-');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  if (dialect !== 'host') {
    const written = spawnSync('bash', [SHIM_WRITER, bin, dialect], { encoding: 'utf8' });
    assert.equal(written.status, 0,
      `could not write the ${dialect} mktemp shim: ${written.stdout}${written.stderr}`);
  }
  // "missing" names a directory that was never created: the real mktemp and
  // both shims fail on it the way an unusable TMPDIR does, with no chmod.
  const tmp = path.join(root, tmpdir === 'ok' ? 'tmp' : 'no-such-dir');
  if (tmpdir === 'ok') fs.mkdirSync(tmp);
  return { root, bin, tmp, dialect };
}

function runUnderSandbox(sandbox, body) {
  const env = { ...process.env, TMPDIR: sandbox.tmp };
  if (sandbox.dialect !== 'host') env.PATH = `${sandbox.bin}:${process.env.PATH}`;
  // Same unset the acceptance handlers do: an exported registry from whatever
  // shell launched this run would short-circuit the creation guard under test,
  // so invariant 2's fail-loud branch would never be reached at all.
  delete env.__SWARMFORGE_TMP_CLEANUP_REGISTRY;
  const res = spawnSync('bash', ['-c', body], { encoding: 'utf8', env });
  return { exit: res.status, output: `${res.stdout || ''}${res.stderr || ''}` };
}

function readAll(output, name) {
  return [...output.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))].map((m) => m[1]);
}

// ── invariant 1: dialect parity ────────────────────────────────────────────

// A program is a list of registrations plus how it ends. `depth` is how many
// nested command substitutions the register_tmp_dir call sits inside - BL-801's
// whole finding is that `$(...)` forks, so a registration made at depth n must
// still reach the top-level EXIT trap.
function generateProgram(rng) {
  const count = rng(4);                       // 0..3 - zero registrations included
  const registrations = [];
  for (let i = 0; i < count; i += 1) {
    registrations.push({ depth: rng(3) + 1 }); // 1..3 - depth 1 is the direct site
  }
  return { registrations, ending: rng(2) === 0 ? 'clean' : 'failed' };
}

function programScript({ registrations, ending }) {
  const lines = ['set -euo pipefail', `source ${JSON.stringify(HELPER)}`];
  registrations.forEach(({ depth }, i) => {
    if (depth === 1) {
      lines.push(`ROOT_${i}="$(${MAKE_ROOT})"`, `register_tmp_dir "$ROOT_${i}"`);
    } else {
      // depth 2 is one `$(...)` fork around the registration; each further
      // level wraps the previous one, so the registration runs that many
      // subshells down from the top-level script.
      let call = `mk_${i}`;
      lines.push(`mk_${i}() { local d; d="$(${MAKE_ROOT})"; register_tmp_dir "$d"; printf '%s' "$d"; }`);
      for (let level = 2; level < depth; level += 1) {
        lines.push(`wrap_${i}_${level}() { printf '%s' "$(${call})"; }`);
        call = `wrap_${i}_${level}`;
      }
      lines.push(`ROOT_${i}="$(${call})"`);
    }
    lines.push(`echo "ROOT=$ROOT_${i}"`);
  });
  lines.push('[[ -f "$__SWARMFORGE_TMP_CLEANUP_REGISTRY" ]] && echo REGISTRY=created || echo REGISTRY=missing');
  lines.push(ending === 'failed' ? 'false' : 'true');
  return lines.join('\n');
}

function observe(program, dialect) {
  const sandbox = newSandbox(dialect);
  const { exit, output } = runUnderSandbox(sandbox, programScript(program));
  const roots = readAll(output, 'ROOT');
  return {
    exit,
    output,
    registry: readAll(output, 'REGISTRY')[0] || 'absent',
    rootCount: roots.length,
    survivors: roots.filter((r) => fs.existsSync(r)),
  };
}

test('BL-1058 invariant 1: the helper behaves identically under either mktemp dialect', () => {
  const rng = makeRng(1058);
  const reach = { zeroRegistrations: 0, manyRegistrations: 0, deep: 0, clean: 0, failed: 0 };

  for (let r = 0; r < PARITY_RUNS; r += 1) {
    const program = generateProgram(rng);
    if (program.registrations.length === 0) reach.zeroRegistrations += 1;
    if (program.registrations.length >= 3) reach.manyRegistrations += 1;
    if (program.registrations.some((x) => x.depth >= 2)) reach.deep += 1;
    reach[program.ending] += 1;

    const gnu = observe(program, 'gnu');
    const bsd = observe(program, 'bsd');
    const shape = JSON.stringify(program);

    for (const [dialect, seen] of [['GNU', gnu], ['BSD', bsd]]) {
      assert.equal(seen.registry, 'created',
        `${dialect} run ${r} never created the registry (${shape}): ${seen.output}`);
      assert.equal(seen.rootCount, program.registrations.length,
        `${dialect} run ${r} registered ${seen.rootCount} of ${program.registrations.length} roots: ${seen.output}`);
      assert.deepEqual(seen.survivors, [],
        `${dialect} run ${r} left ${seen.survivors.length} root(s) behind (${shape}): ${seen.survivors.join(', ')}`);
      assert.ok(!/unbound variable/i.test(seen.output),
        `${dialect} run ${r} raised an unbound-variable error: ${seen.output}`);
      const expectedExit = program.ending === 'failed' ? false : true;
      assert.equal(seen.exit === 0, expectedExit,
        `${dialect} run ${r} exited ${seen.exit} for a ${program.ending} ending: ${seen.output}`);
    }

    // THE INVARIANT: the two userlands are indistinguishable from outside.
    assert.equal(gnu.exit, bsd.exit,
      `run ${r} exited ${gnu.exit} under GNU but ${bsd.exit} under BSD (${shape})`);
    assert.equal(gnu.registry, bsd.registry,
      `run ${r} registry was ${gnu.registry} under GNU but ${bsd.registry} under BSD (${shape})`);
    assert.equal(gnu.rootCount, bsd.rootCount,
      `run ${r} registered ${gnu.rootCount} roots under GNU but ${bsd.rootCount} under BSD (${shape})`);
    assert.equal(gnu.survivors.length, bsd.survivors.length,
      `run ${r} swept differently across dialects (${shape})`);
  }

  assert.ok(reach.zeroRegistrations >= 3, `zero-registration programs reached only ${reach.zeroRegistrations} times`);
  assert.ok(reach.manyRegistrations >= 3, `3-registration programs reached only ${reach.manyRegistrations} times`);
  assert.ok(reach.deep >= 10, `subshell-nested registrations reached only ${reach.deep} times`);
  assert.ok(reach.clean >= 10, `clean endings reached only ${reach.clean} times`);
  assert.ok(reach.failed >= 10, `failed endings reached only ${reach.failed} times`);
});

test('BL-1058 invariant 1: no single platform mktemp dialect appears in the call', () => {
  // The second clause is about the SOURCE, not a run: a call that happens to
  // work on both hosts today by accident is not the same as one that names
  // neither dialect. Every mktemp invocation in the helper is checked, so a
  // future second call cannot slip a dialect flag in beside a clean first one.
  const source = fs.readFileSync(HELPER, 'utf8');
  const calls = source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .filter((line) => /\bmktemp\b/.test(line));

  assert.ok(calls.length > 0, 'the helper contains no mktemp call at all - the property has nothing to quantify over');
  for (const call of calls) {
    assert.ok(!/\bmktemp\s+(-\w+\s+)*-t\b/.test(call),
      `mktemp -t is BSD-only prefix syntax and GNU refuses it: ${call.trim()}`);
    assert.ok(!/\bmktemp\s[^\n]*(--tmpdir|--suffix|-p\b)/.test(call),
      `that mktemp option is GNU-only and BSD refuses it: ${call.trim()}`);
    assert.match(call, /XXX/,
      `an explicit template with X's is the form both userlands accept: ${call.trim()}`);
  }
});

// ── invariant 2: never partially initialized ───────────────────────────────

// The full cross-product, enumerated rather than sampled: whether mktemp can
// produce a file at all is the axis the disjunction turns on, so leaving it to
// a coin flip is how a generator quantifies over only the happy branch.
const AVAILABILITY = [];
for (const dialect of ['gnu', 'bsd', 'host', 'refuses-everything']) {
  for (const tmpdir of ['ok', 'missing']) {
    AVAILABILITY.push({ dialect, tmpdir });
  }
}

test('BL-1058 invariant 2: sourcing either yields a usable registry or fails loud by name', () => {
  const rng = makeRng(20581);
  const reach = { usable: 0, failedLoud: 0, missingTmpdir: 0, withRegistrations: 0 };

  for (const availability of AVAILABILITY) {
    // Whether the body goes on to REGISTER is the second axis: the unbound
    // variable the invariant forbids only ever surfaced at a later
    // register_tmp_dir, never at the source itself.
    for (const registrations of [0, 1 + rng(3)]) {
      const sandbox = newSandbox(availability.dialect, { tmpdir: availability.tmpdir });
      const lines = ['set -euo pipefail', `source ${JSON.stringify(HELPER)}`];
      for (let i = 0; i < registrations; i += 1) {
        lines.push(`register_tmp_dir "$TMPDIR/registered-${i}"`);
      }
      lines.push('echo REACHED_BODY');
      const { exit, output } = runUnderSandbox(sandbox, lines.join('\n'));
      const shape = `${availability.dialect}/${availability.tmpdir}/${registrations} registrations`;

      if (registrations > 0) reach.withRegistrations += 1;
      if (availability.tmpdir === 'missing') reach.missingTmpdir += 1;

      // Neither branch may EVER surface as an unbound variable - that is the
      // partially-initialized state the invariant names, and it is the one
      // outcome forbidden on both sides of the disjunction.
      assert.ok(!/unbound variable/i.test(output),
        `${shape}: the helper left the shell partially initialized: ${output}`);

      if (exit === 0) {
        assert.match(output, /REACHED_BODY/,
          `${shape}: exited 0 without ever reaching the body: ${output}`);
        reach.usable += 1;
      } else {
        assert.ok(!/REACHED_BODY/.test(output),
          `${shape}: kept running past a registry it could not create: ${output}`);
        assert.match(output, /tmp-cleanup registry/i,
          `${shape}: the failure never names the tmp-cleanup registry: ${output}`);
        reach.failedLoud += 1;
      }
    }
  }

  assert.ok(reach.usable >= 4, `the usable-registry branch reached only ${reach.usable} times`);
  assert.ok(reach.failedLoud >= 4, `the fail-loud branch reached only ${reach.failedLoud} times`);
  assert.ok(reach.missingTmpdir >= 4, `an unusable TMPDIR reached only ${reach.missingTmpdir} times`);
  assert.ok(reach.withRegistrations >= 4, `runs that go on to register reached only ${reach.withRegistrations} times`);
});
