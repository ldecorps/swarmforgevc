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
