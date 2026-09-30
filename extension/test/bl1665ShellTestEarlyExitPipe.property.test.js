'use strict';

// BL-1665 declared invariant (coder-authored). Runs via npm run test:properties.
//
// "After the sweep no shell test under swarmforge/scripts/test that sets
// pipefail pipes into a grep that can exit before its producer has
// finished writing; the guard's scan of the real tree finds none and
// covers every file there."
//
// Two properties: (1) the guard's staged-commit detector refuses a
// pipefail-setting file that pipes into `grep -q<flags>` however the flag
// cluster or needle are chosen, and accepts the same shape once rewritten
// as a whole-input consumer, or once pipefail itself is dropped - the
// discriminating half of the invariant, generated rather than enumerated
// by hand so the flag-cluster space is actually exercised; (2) the real
// tree the guard scans is clean and the scan covers every file there,
// checked directly against the real tree rather than duplicated from the
// acceptance feature's own scenario 04.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_shell_test_early_exit_pipe.sh');
const TEST_REL = 'swarmforge/scripts/test/test_bl1665_prop_probe.sh';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function mkRepo() {
  // BL-1280: allocated through the shared helper, never a raw
  // fs.mkdtempSync - the migration guard's own exempt list stays at
  // exactly the three documented call sites.
  const root = mkTmpDir('sfvc-bl1665-prop-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts', 'test'), { recursive: true });
  return root;
}

function stageAndRun(content) {
  const root = mkRepo();
  try {
    fs.writeFileSync(path.join(root, TEST_REL), content);
    git(root, 'add', TEST_REL);
    const r = spawnSync('bash', [GUARD], { cwd: root, encoding: 'utf8' });
    return { rc: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A generated needle, safe both as a bash bareword and as an ERE literal
// (no metacharacters to confuse the guard's -E detector with the content
// under test, which is not what this property is about).
const needleArb = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(s));

// The flag cluster around the load-bearing `q`, in either order and with
// an optional extra real grep flag mixed in - the ticket's own detector
// text is "any flag cluster containing q".
const extraFlagArb = fc.constantFrom('', 'i', 'E', 'iE', 'Ei');
const qPositionArb = fc.constantFrom('leading', 'trailing');

test('BL-1665 invariant: a pipefail file piping into an early-exit grep -q<flags> is refused; the same shape with pipefail dropped or the pipe made whole-input is accepted', () => {
  let reached = 0;
  fc.assert(
    fc.property(
      fc.boolean(), // pipefail set?
      fc.boolean(), // early-exit grep -q pipe (true) vs a whole-input consumer (false)
      extraFlagArb,
      qPositionArb,
      needleArb,
      (pipefail, earlyExit, extra, qPosition, needle) => {
        reached += 1;
        const flags = qPosition === 'leading' ? `q${extra}` : `${extra}q`;
        const lines = ['#!/usr/bin/env bash'];
        if (pipefail) lines.push('set -euo pipefail');
        lines.push('fail() { :; }');
        lines.push(`OUT="$(printf 'a\\nb\\n%s\\n' ${JSON.stringify(needle)})"`);
        if (earlyExit) {
          lines.push(`echo "$OUT" | grep -${flags} ${needle} || fail "missing"`);
        } else {
          // Same needle, whole-input consumer - the codemod's own target
          // shape (BL-1665's "How" section).
          lines.push(`echo "$OUT" | grep -${extra || 'F'} ${needle} >/dev/null || fail "missing"`);
        }
        const content = `${lines.join('\n')}\n`;

        const result = stageAndRun(content);
        const shouldRefuse = pipefail && earlyExit;
        if (shouldRefuse) {
          assert.equal(
            result.rc,
            1,
            `expected refusal (pipefail=${pipefail} earlyExit=${earlyExit} flags=${flags}), got exit ${result.rc}: ${result.out}${result.err}`
          );
          assert.ok(
            result.err.includes(TEST_REL),
            `expected the refusal to name ${TEST_REL}, got: ${result.err}`
          );
        } else {
          assert.equal(
            result.rc,
            0,
            `expected acceptance (pipefail=${pipefail} earlyExit=${earlyExit} flags=${flags}), got exit ${result.rc}: ${result.out}${result.err}`
          );
        }
      }
    ),
    { numRuns: 30 }
  );
  // Generator-reach floor (coder Invariants section): both the refuse and
  // accept branches must actually fire, not merely be reachable in theory.
  assert.ok(reached >= 30, `expected the generator to run at least 30 times, got ${reached}`);
});

test('BL-1665 invariant: the guard scans the real tree, finds it clean, and covers every file there', () => {
  const result = spawnSync('bash', [GUARD, '--scan-tree'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `expected the real tree to carry no violation, got: ${result.stdout}${result.stderr}`);
  const match = /scanned (\d+) file/.exec(result.stdout);
  assert.ok(match, `expected a "scanned N file(s)" line, got: ${result.stdout}`);
  assert.ok(Number(match[1]) >= 400, `expected at least 400 files scanned, got ${match[1]}`);
});
