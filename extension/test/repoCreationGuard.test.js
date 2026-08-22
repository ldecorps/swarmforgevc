const assert = require('node:assert/strict');
const path = require('node:path');

const {
  createsRepository,
  exemptionReason,
  violationFor,
  findRepoCreations,
  isSelfExempt,
} = require('./helpers/repoCreationGuard');

// BL-1039. Seventeen files ran `git init` and built real commits, most once per
// scenario - four spawns before the behaviour under test was reached.
//
// This file is the guard's own coverage AND the lane-level gate the ticket's
// `required_wiring` names: "the lane-level scan needs a caller on every
// npm test or invariant 1 is never checked". Architect SEND BACK #1 (D4)
// found `findRepoCreations` exported and never called from either lane, so 59
// real violations were invisible to `npm test` and would have stayed invisible
// after merge - "a gate that can never usefully turn red at all".

// ── the call shapes that create a repository ──────────────────────────────

test('BL-1039: an inline execFileSync spawn of `git init` creates a repository', () => {
  assert.equal(createsRepository("execFileSync('git', ['init', '-q'], { cwd: root });"), true);
});

test('BL-1039: a `git init` command STRING creates a repository', () => {
  assert.equal(createsRepository("execSync('git init -q', { cwd: root });"), true);
});

test('BL-1039: a --bare init creates a repository', () => {
  assert.equal(createsRepository("execFileSync('git', ['init', '--bare'], { cwd: remote });"), true);
});

// D1 - the blind spot that sent this parcel back. The guard recognised only
// `'git'` as a quoted STRING argument, so it could not see the DOMINANT shape
// in this corpus: a local wrapper function literally named `git`, where `git`
// is a bare identifier rather than a string. 43 files used it and the guard
// saw none of them - zero overlap with its violation list.
test('BL-1039 D1: a local `git()` wrapper call creates a repository', () => {
  const text = [
    'function git(cwd, args) { execFileSync("git", args, { cwd }); }',
    "git(dir, ['init', '-q']);",
  ].join('\n');
  assert.equal(createsRepository(text), true);
});

test('BL-1039 D1: the wrapper shape is caught by the CALL SITE, with no wrapper definition in the file', () => {
  // Keying on the call site rather than resolving the binding is deliberate
  // and is the shortcut the inline case already takes. A file may import its
  // wrapper, or define it far from the call.
  assert.equal(createsRepository("git(root, ['init', '-q']);"), true);
});

test('BL-1039 D1: a wrapper call taking a date or option argument first is still caught', () => {
  assert.equal(createsRepository("git(dir, ['init', '-q'], '2026-08-22T00:00:00Z');"), true);
});

// ── what is NOT repository creation ───────────────────────────────────────

test('BL-1039: committing into a repository the test was GIVEN is not creation', () => {
  // The guard keys on creation only. A caller that takes a repo from the
  // shared fixture and then builds its own commits is exactly the intended
  // end state, so its `git add`/`git commit` must not be flagged.
  const text = ["copySeededRepoInto(root);", "git(root, ['add', '-A']);", "git(root, ['commit', '-m', 'x']);"].join('\n');
  assert.equal(createsRepository(text), false);
});

test('BL-1039: a differently-named identifier ending in git is not a wrapper call', () => {
  // `gitIn(...)` is the shared fixture helper's OWN internal spawn. Matching
  // it here would flag the one file whose whole purpose is to create the
  // template - the BL-1032 failure repeated.
  assert.equal(createsRepository("gitIn(dir, ['init', '-q']);"), false);
});

test('BL-1039: a call shape naming a subcommand other than init is not creation', () => {
  assert.equal(createsRepository("git(dir, ['status', '--porcelain']);"), false);
});

// EXECUTING vs ASSERTING - the distinction BL-1032 exists to draw. A guard
// test's fixture strings CONTAIN the needle as test data and spawn nothing.
test('BL-1039: a whole-line string literal containing a spawn is DATA, not a spawn', () => {
  assert.equal(createsRepository("  \"execFileSync('git', ['init', '-q'], { cwd: root });\",") , false);
});

test('BL-1039 D1: a whole-line string literal containing a WRAPPER call is also DATA', () => {
  // The same rule must cover the shape D1 adds, or fixing the blind spot
  // reopens BL-1032's defect against every guard test that quotes it.
  assert.equal(createsRepository("  \"git(dir, ['init', '-q']);\","), false);
});

// ── exemptions must record a reason ───────────────────────────────────────

test('BL-1039: an exemption with a recorded reason is honoured', () => {
  const text = "// BL-1039-EXEMPT: asserts on a repo it must create itself, at a known SHA\ngit(dir, ['init', '-q']);";
  assert.equal(exemptionReason(text), 'asserts on a repo it must create itself, at a known SHA');
  assert.equal(violationFor('x.test.js', text), null);
});

test('BL-1039: a BARE exemption marker does not excuse anything', () => {
  // [ \t]* not \s*: \s crosses the newline and would capture the next line's
  // first word as the "reason", so every empty marker would read as
  // justified - the guard failing OPEN, which is the hazard the rule closes.
  const text = "// BL-1039-EXEMPT:\ngit(dir, ['init', '-q']);";
  assert.equal(exemptionReason(text), null);
  assert.ok(violationFor('x.test.js', text));
});

test('BL-1039: a violation names the file and says what it did', () => {
  const v = violationFor('x.test.js', "git(dir, ['init', '-q']);");
  assert.equal(v.file, 'x.test.js');
  assert.ok(v.reason && v.reason.length > 0);
});

// ── the guard does not flag its own machinery ─────────────────────────────

test('BL-1039: the guard, the fixture helper and their tests are self-exempt', () => {
  assert.equal(isSelfExempt('helpers/repoCreationGuard.js'), true);
  assert.equal(isSelfExempt('helpers/sharedRepoFixture.js'), true);
  assert.equal(isSelfExempt('repoCreationGuard.test.js'), true);
  assert.equal(isSelfExempt('sharedRepoFixture.test.js'), true);
  assert.equal(isSelfExempt('someOther.test.js'), false);
});

// ── D4: the lane-level gate ───────────────────────────────────────────────

test('BL-1039 D4: the real extension/test tree creates no git repository of its own', () => {
  const violations = findRepoCreations(path.join(__dirname));
  assert.deepEqual(
    violations,
    [],
    'every unit-lane test must take its repository from the shared seeded fixture, or record why it cannot:\n' +
      violations.map((v) => `  ${v.file}: ${v.reason}`).join('\n')
  );
});
