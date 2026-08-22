const assert = require('node:assert/strict');
const path = require('node:path');

const {
  liveRepoDerivation,
  exemptionReason,
  violationFor,
  findLiveRepoDerivations,
  isSelfExempt,
} = require('./helpers/liveRepoDerivationGuard');

// BL-1038. Fixture builders copied all 208 live .bb scripts (2.16MB) per build,
// so every new script slowed every fixture build forever - the growth term
// behind four budget raises in four days, each correct when measured and stale
// within days. This guard stops new ones appearing.

// ── what counts as a growth term ──────────────────────────────────────────

test('BL-1038: walking live git history is a growth term', () => {
  const d = liveRepoDerivation("const REPO = path.join(__dirname, '..', '..');\nexecSync('git log --format=%H', { cwd: REPO });");
  assert.match(d, /history depth/);
});

test('BL-1038: enumerating a live repository directory is a growth term', () => {
  const d = liveRepoDerivation("const REPO_ROOT = path.join(__dirname, '..', '..');\nfs.readdirSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'));");
  assert.match(d, /repo size/);
});

test('BL-1038: reading ONE named file from the live repo is NOT a growth term', () => {
  // O(1) whatever the repo's size. Flagging it would bury the real growth
  // terms among ~30 files that cost nothing - which an earlier version did.
  assert.equal(
    liveRepoDerivation("const REPO = path.join(__dirname, '..', '..');\nfs.readFileSync(path.join(REPO, 'swarmforge/scripts/x.bb'), 'utf8');"),
    null
  );
});

test('BL-1038: a test that builds its OWN git repo is NOT a violation - that is BL-1039', () => {
  // The boundary this ticket draws explicitly, and the one that took four
  // attempts to place. A fixture repo's cost is set by the fixture, not by
  // this repository. An earlier version matched any `git log` in a file that
  // merely MENTIONED the live root, and so named four bridge tests that
  // `git init` their own repos - reporting the sibling ticket's family as
  // this one's violations.
  const text = [
    "const REPO_ROOT = path.join(__dirname, '..', '..');",
    "const root = mkTmpDir('fixture-');",
    "execFileSync('git', ['init', '-q'], { cwd: root });",
    "execFileSync('git', ['-C', root, 'log', '--format=%H']);",
  ].join('\n');
  assert.equal(liveRepoDerivation(text), null,
    'a git command against a temp fixture must not read as a live-repo derivation');
});

test('BL-1038: the growth op must target the BOUND root, not merely coexist with it', () => {
  // The same distinction stated directly: an unbound inline join cannot be the
  // cwd of a later command without going through a name.
  assert.equal(liveRepoDerivation("fs.readdirSync(path.join(__dirname, '..', '..', 'x'));"), null);
});

// ── the exemption records WHY, and the relation is what is checked ────────

test('BL-1038: an exemption with a recorded reason is honoured', () => {
  const text = "// BL-1038-EXEMPT: smoke-tests that the real maintained diagrams still render\nconst REPO = path.join(__dirname, '..', '..');\nfs.readdirSync(path.join(REPO, 'docs'));";
  assert.ok(exemptionReason(text));
  assert.equal(violationFor('x.test.js', text), null);
});

test('BL-1038: a BARE exemption marker with no reason is NOT honoured', () => {
  // Present-but-unjustified is the state BL-999 found one layer down and the
  // reason budgets decayed. A \s* here would cross the newline and capture the
  // next line's first word as the "reason" - the guard failing OPEN.
  const text = "// BL-1038-EXEMPT:\nconst REPO = path.join(__dirname, '..', '..');\nfs.readdirSync(path.join(REPO, 'docs'));";
  assert.equal(exemptionReason(text), null);
  const v = violationFor('x.test.js', text);
  assert.ok(v, 'a marker with no reason must still fail');
  assert.equal(v.file, 'x.test.js');
});

test('BL-1038: a violation names what the file reached for, not merely that it did', () => {
  const v = violationFor('x.test.js', "const REPO = path.join(__dirname, '..', '..');\nexecSync('git log', { cwd: REPO });");
  assert.ok(v.reason && v.reason.length > 0,
    'naming the file without saying what it reached for leaves the reader to re-derive it');
});

// ── the guard does not flag its own machinery ─────────────────────────────

test('BL-1038: the guard, the fixture helper and this test file are self-exempt', () => {
  // Each necessarily contains the pattern matched on. Without the exclusion
  // the guard goes red precisely because the code is correct (BL-1032).
  assert.equal(isSelfExempt('helpers/liveRepoDerivationGuard.js'), true);
  assert.equal(isSelfExempt('helpers/pinnedRepoFixture.js'), true);
  assert.equal(isSelfExempt('liveRepoDerivationGuard.test.js'), true);
  assert.equal(isSelfExempt('someOther.test.js'), false);
});

// ── the real tree ─────────────────────────────────────────────────────────

test('BL-1038: the real extension/test tree has no unjustified live-repository derivation', () => {
  const violations = findLiveRepoDerivations(path.join(__dirname));
  assert.deepEqual(violations, [],
    'every live-repository derivation must read a pinned fixture or record why it cannot:\n' +
      violations.map((v) => `  ${v.file}: ${v.reason}`).join('\n')
  );
});
