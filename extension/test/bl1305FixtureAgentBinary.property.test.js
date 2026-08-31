'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');

const {
  mkFakeBin,
  fakeEnv,
  AGENT_NAME,
} = require('../../specs/pipeline/steps/roleLifecycleParkUnneededSteps');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1305 declared invariants
// (backlog/active/BL-1305-fixture-agent-binary-is-the-stub.yaml):
//
// 1. "No acceptance step handler ever executes a real agent binary: a
//    fixture's agent command runs the fixture's own stub, whatever the pane
//    shell's startup files do to PATH."
//    -> encoded below by "the stub wins against any arrangement of rival
//       binaries a startup file could prepend".
//
// Invariant 2 ("reaches its stub by a path the shell cannot re-order") was
// RETIRED by the specifier on 2026-08-31 as a mechanism mandate that could
// not be satisfied - the config's agent column is a closed allowlist that
// refuses a path (coder report backlog/evidence/BL-1305-coder-spec-gap-
// 20260831.md, adjudication backlog/evidence/BL-1305-bounce-20260831.md).
// Invariant 1 already carries the property in full. The stronger case it
// used to describe is still exercised here, as a property rather than a
// mandate: the stub wins even when the fixture directory is NOT first in
// PATH, i.e. precisely the cases where precedence ALONE would lose.
//
// GENERATOR REACH. A rival directory is only interesting if it actually
// collides, so every generated rival is CONSTRUCTED to hold a binary named
// exactly AGENT_NAME - the collision is by construction, never left to
// chance. The fixture directory's position in PATH is drawn explicitly,
// including the last position, so the "precedence alone would lose" states
// the invariant quantifies over are reached on purpose rather than hoped for.

const HAS_ZSH = spawnSync('zsh', ['-c', 'exit 0']).status === 0;

const RIVAL_MARKER = 'RIVAL_BINARY_RAN';

function mkRival() {
  const dir = mkTmpDir('bl1305-prop-rival-');
  const bin = path.join(dir, AGENT_NAME);
  fs.writeFileSync(bin, `#!/usr/bin/env bash\necho ${RIVAL_MARKER}\nexit 0\n`);
  fs.chmodSync(bin, 0o755);
  return dir;
}

// Build a PATH in which `rivals` sit around the fixture dir, with the fixture
// dir at `fixtureAt`. This is what a startup file does to PATH behind the
// fixture's back.
function composePath(fixtureDir, rivals, fixtureAt, basePath) {
  const entries = rivals.slice();
  const at = Math.min(fixtureAt, entries.length);
  entries.splice(at, 0, fixtureDir);
  return entries.concat([basePath]).join(path.delimiter);
}

function resolveInZsh(env) {
  return spawnSync('zsh', ['-c', `command -v ${AGENT_NAME}`], {
    encoding: 'utf8',
    env,
    timeout: 10000,
  }).stdout.trim();
}

test('invariant 1: the fixture stub wins against any arrangement of rival binaries, at any PATH position', { skip: !HAS_ZSH }, () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 0, max: 4 }),
      (rivalCount, fixtureAt) => {
        const fakeBin = mkFakeBin();
        const rivals = Array.from({ length: rivalCount }, () => mkRival());
        try {
          const env = fakeEnv(fakeBin);
          env.PATH = composePath(fakeBin, rivals, fixtureAt, process.env.PATH);

          assert.equal(
            resolveInZsh(env),
            path.join(fakeBin, AGENT_NAME),
            `stub must win with ${rivalCount} rival(s), fixture at position ${fixtureAt}`
          );
        } finally {
          fs.rmSync(fakeBin, { recursive: true, force: true });
          for (const r of rivals) fs.rmSync(r, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 12 }
  );
});

test('reach floor: the generator actually produces cases where PATH precedence alone would lose', { skip: !HAS_ZSH }, () => {
  // An asserted reachability floor, not a hoped-for one: without the fixture's
  // own startup file, a rival placed ahead of the fixture dir DOES win. If this
  // stops being true the property above has gone vacuous.
  const fakeBin = mkFakeBin();
  const rival = mkRival();
  try {
    const env = fakeEnv(fakeBin);
    // Rival first, fixture second: precedence alone loses here.
    env.PATH = composePath(fakeBin, [rival], 1, process.env.PATH);
    assert.ok(
      env.PATH.indexOf(rival) < env.PATH.indexOf(fakeBin),
      'the rival must genuinely sit ahead of the fixture dir in PATH'
    );

    // Same PATH, but with the fixture's startup-file isolation removed - the
    // pre-fix behaviour. The stub LOSES, proving the state is reachable.
    //
    // Note what it loses to: on a host whose ~/.zshenv prepends the real
    // agent's directory, the winner is not even the rival this test planted -
    // it is the REAL binary, which the startup file puts ahead of the whole
    // composed PATH. That is exactly the production defect (21 real agents,
    // 2026-08-30), so the assertion is "not the stub" rather than naming one
    // specific winner, which would make this test host-dependent.
    const unprotected = { ...env };
    delete unprotected.ZDOTDIR;
    const unprotectedWinner = resolveInZsh(unprotected);
    assert.notEqual(
      unprotectedWinner,
      path.join(fakeBin, AGENT_NAME),
      'without startup-file isolation the stub must lose - otherwise this reach floor is vacuous'
    );

    // With isolation in place, the same state resolves to the stub.
    assert.equal(resolveInZsh(env), path.join(fakeBin, AGENT_NAME));
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(rival, { recursive: true, force: true });
  }
});
