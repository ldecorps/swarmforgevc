'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  findSocketFixtureRootViolation,
  scanForSocketFixtureRootViolations,
} = require('../../specs/pipeline/steps/lib/socketFixtureRootGuard');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-948: the standing-suite home for the socket-fixture-root gate, the
// same shape as tempDirTrapGuard.test.js (BL-872): the shared module owns
// the rules, this file proves the scan is COLLECTED and enforced by the one
// suite every parcel runs. The generative coverage of the classifier's
// flag-iff-(socket AND long-base) truth table lives in
// bl948SocketFixtureInvariants.property.test.js.

const STEPS_DIR = path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps');

test('a socket-building step file rooted at os.tmpdir() is flagged (smoke test of the shared module)', () => {
  const text =
    "const root = fs.mkdtemp" + "Sync(path.join(os." + "tmpdir(), 'x-'));\n" +
    "fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);\n";
  assert.ok(findSocketFixtureRootViolation('exampleSteps.js', text));
});

test('a fixture root with no socket anywhere near it is not flagged', () => {
  const text = "const root = fs.mkdtemp" + "Sync(path.join(os." + "tmpdir(), 'x-'));\n";
  assert.equal(findSocketFixtureRootViolation('exampleSteps.js', text), null);
});

test('prose about sockets in comments never pulls a file into scope', () => {
  const text =
    '// this fixture deliberately builds no tmux-socket at all\n' +
    "const root = fs.mkdtemp" + "Sync(path.join(os." + "tmpdir(), 'x-'));\n";
  assert.equal(findSocketFixtureRootViolation('exampleSteps.js', text), null);
});

// ── BL-948 hardening (hardender): the rule must not be a list of SPELLINGS ──
// Invariant 1 says the gate defines the adoption set by inspection, so that
// a fourth recurrence is impossible rather than merely unlikely. A rule that
// recognises exactly ONE syntactic form is a hand-maintained list of
// spellings rather than of file names: the next author only has to hoist the
// base into a variable. Measured 2026-08-20 against the original pattern:
// 1 of these 6 long-base spellings was caught, 5 sailed through.
//
// Every body below is assembled by concatenation so this file carries no raw
// mkdtemp call site of its own - tmpDirMigrationGuard scans extension/test/
// and would otherwise read this test DATA as a violation.

const SOCKET_LINE = "const sock = `${root}/.swarmforge/tmux-socket`;\n";
const MKDTEMP = "fs.mkdtemp" + "Sync";
const TMPDIR = "tmp" + "dir()";

const LONG_BASE_SPELLINGS = {
  'path.join(os.tmpdir(), …) — the canonical form':
    MKDTEMP + "(path.join(os." + TMPDIR + ", 'p-'));\n",
  'the base hoisted into a local variable':
    "const base = os." + TMPDIR + ";\n" + MKDTEMP + "(path.join(base, 'p-'));\n",
  'tmpdir destructured off the os module':
    "const { tmp" + "dir } = require('node:os');\n" + MKDTEMP + "(path.join(" + TMPDIR + ", 'p-'));\n",
  'interpolated into a template literal':
    MKDTEMP + "(`${os." + TMPDIR + "}/p-`);\n",
  'concatenated onto a string':
    MKDTEMP + "(os." + TMPDIR + " + '/p-');\n",
  'reached through an inline require':
    MKDTEMP + "(path.join(require('os')." + TMPDIR + ", 'p-'));\n",
};

for (const [spelling, body] of Object.entries(LONG_BASE_SPELLINGS)) {
  test(`a socket fixture is flagged when the long base is written as: ${spelling}`, () => {
    const violation = findSocketFixtureRootViolation('exampleSteps.js', SOCKET_LINE + body);
    assert.ok(
      violation,
      `the gate missed a long-base root spelled "${spelling}" - it is matching one syntactic ` +
        'form rather than the base itself, so a socket fixture written this way reproduces ' +
        'the defect BL-948 exists to make impossible'
    );
  });
}

const SHORT_BASE_SPELLINGS = {
  'the shared helper': "const root = mkSocketFixtureRoot('p-');\n",
  'a literal short base': MKDTEMP + "('/tmp/p-');\n",
  'a joined short base': MKDTEMP + "(path.join('/tmp', 'p-'));\n",
};

for (const [spelling, body] of Object.entries(SHORT_BASE_SPELLINGS)) {
  test(`a socket fixture rooted at a short base is NOT flagged: ${spelling}`, () => {
    assert.equal(
      findSocketFixtureRootViolation('exampleSteps.js', SOCKET_LINE + body),
      null,
      `broadening the rule must not churn correct fixtures - "${spelling}" is already short`
    );
  });
}

// The long-base check blanks quoted-string CONTENTS so a file carrying an
// EXAMPLE of the violation (BL-948's own acceptance steps do exactly that)
// is not read as a call site. That must not blind it to a REAL call site on
// the same line as an unrelated string literal.
test('an example of the pattern inside a quoted string is not a call site', () => {
  const text = SOCKET_LINE + "const example = \"" + MKDTEMP + "(path.join(os.\" + \"" + TMPDIR + ", 'p-'))\";\n";
  assert.equal(findSocketFixtureRootViolation('exampleSteps.js', text), null);
});

test('a real call site is still flagged when the same line carries a string literal', () => {
  const text = SOCKET_LINE + "const root = " + MKDTEMP + "(path.join(os." + TMPDIR + ", 'prefix-with-a-long-name-'));\n";
  assert.ok(findSocketFixtureRootViolation('exampleSteps.js', text));
});

// ── break-then-fix: the DIRECTORY WALK reaches disk from this suite ────────

test('flags a violation planted in a fixture dir, then confirms clean once moved to the helper', () => {
  const root = mkTmpDir('sfvc-socket-root-guard-fixture-');
  const offender = path.join(root, 'offenderSteps.js');
  fs.writeFileSync(
    offender,
    "const root = fs.mkdtemp" + "Sync(path.join(os." + "tmpdir(), 'x-'));\nconst sock = `${root}/.swarmforge/tmux-socket`;\n"
  );

  const before = scanForSocketFixtureRootViolations(root);
  assert.equal(before.length, 1);
  assert.equal(before[0].file, offender);

  fs.writeFileSync(
    offender,
    "const root = mkSocketFixtureRoot('x-');\nconst sock = `${root}/.swarmforge/tmux-socket`;\n"
  );
  assert.deepEqual(scanForSocketFixtureRootViolations(root), []);
});

// ── BL-948: the actual adoption-complete assertion over the REAL tree ──────

test('the real specs/pipeline/steps tree has zero socket-fixture long-base violations', () => {
  const violations = scanForSocketFixtureRootViolations(STEPS_DIR);
  assert.deepEqual(
    violations,
    [],
    `expected zero socket-fixture-root violations under specs/pipeline/steps, found:\n${violations
      .map((v) => `${v.file}: ${v.reason}`)
      .join('\n')}`
  );
});
