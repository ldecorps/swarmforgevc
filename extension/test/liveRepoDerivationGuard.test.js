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

test('BL-1038: a file doing BOTH is flagged only for the live read', () => {
  // Scenario 07. The two families can occur in one file; they are separable by
  // OPERATION, not by file. Removing the live read alone must clear it - the
  // git repo it builds is BL-1039's business, not this guard's.
  const both = [
    "const REPO_ROOT = path.join(__dirname, '..', '..');",
    "const root = mkTmpDir('fixture-');",
    "execFileSync('git', ['init', '-q'], { cwd: root });",
    "execFileSync('git', ['-C', root, 'log', '--format=%H']);",
    "fs.readdirSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'));",
  ].join('\n');
  const v = violationFor('both.test.js', both);
  assert.ok(v, 'the live read must still be flagged');
  assert.match(v.reason, /repo size/, 'and named as the live read');
  const withoutLiveRead = both.split('\n').filter((l) => !l.includes('readdirSync')).join('\n');
  assert.equal(violationFor('both.test.js', withoutLiveRead), null,
    'the created git repository alone is not a violation of THIS ticket');
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

// ── D1 (architect SEND BACK #1 and #2): the root ESCAPING into production ──
//
// The four files this ticket was minted to fix reach the live repository
// INDIRECTLY - they hand the bound root to a production module and let it do
// the reading. The guard's first boundary demanded the growth operation be
// written inline in the test's own source, so it saw none of them, reported
// `[]`, and the "real tree is clean" assertion passed vacuously against the
// majority of the ticket's own measured cost.
//
// The boundary therefore moves: handing the LIVE root to production code IS
// the derivation, because the test no longer controls what gets read. The
// guard's own earlier note argued the opposite - "code given a root may read
// one file or a thousand, and no static pattern separates them" - and that is
// exactly why this cannot be settled statically and is settled by a RECORDED
// EXEMPTION instead.

test('BL-1038 D1: the live root handed to an imported production function is a derivation', () => {
  const text = [
    "const { renderBriefingBurndown } = require('../out/tools/render-briefing-burndown');",
    "const repoRoot = path.join(__dirname, '..', '..');",
    'renderBriefingBurndown(repoRoot);',
  ].join('\n');
  assert.match(liveRepoDerivation(text), /production/);
});

test('BL-1038 D1: the root reaches production through a LOCAL wrapper too', () => {
  // renderBriefingDiagramsCli and briefingDigestLineCli both call a local
  // runCli()/runCliSubprocess() rather than the imported entry point directly.
  // A guard that only matched the direct call saw neither.
  const text = [
    "const { main } = require('../out/tools/render-briefing-diagrams');",
    "const REAL_PROJECT_ROOT = path.join(__dirname, '..', '..');",
    'async function runCli(root) { return main(root); }',
    'const diagrams = await runCli(REAL_PROJECT_ROOT);',
  ].join('\n');
  assert.match(liveRepoDerivation(text), /production/);
});

test('BL-1038 D1: an INLINE live root passed straight into the call is caught', () => {
  const text = [
    "const { main } = require('../out/tools/briefing-digest-line');",
    'async function runCli(root) { return main(root); }',
    "const output = await runCli(path.join(__dirname, '..', '..'));",
    ].join('\n');
  assert.match(liveRepoDerivation(text), /production/);
});

test('BL-1038 D1: a local wrapper that SPAWNS the compiled CLI counts as production', () => {
  const text = [
    "const REPO = path.join(__dirname, '..', '..');",
    "function runCliSubprocess(root) { return execFileSync('node', [path.join(root, 'extension', 'out', 'tools', 'x.js')], { cwd: root }); }",
    'runCliSubprocess(REPO);',
  ].join('\n');
  assert.match(liveRepoDerivation(text), /production/);
});

test('BL-1038 D1: a FIXTURE root handed to production code is not a derivation', () => {
  // The whole point of the pinned fixture. Only the LIVE root is the defect.
  const text = [
    "const { renderBriefingBurndown } = require('../out/tools/render-briefing-burndown');",
    'const repoRoot = mkTmpDir("fixture-");',
    'renderBriefingBurndown(repoRoot);',
  ].join('\n');
  assert.equal(liveRepoDerivation(text), null);
});

test('BL-1038 D1: the live root used only to BUILD a path, never handed over, is not a derivation', () => {
  // recordQaBounceCli reads one named file this way. O(1) in the repo's size,
  // and flagging it would bury the real derivations among ~30 that cost nothing.
  const text = [
    "const { readQaBounces } = require('../out/metrics/qaBounceStore');",
    "const p = path.join(__dirname, '..', '..', 'swarmforge', 'roles', 'QA.prompt');",
    'fs.readFileSync(p, "utf8");',
  ].join('\n');
  assert.equal(liveRepoDerivation(text), null);
});

test('BL-1038 D1: handing the live root to a NON-production local helper is not a derivation', () => {
  const text = [
    "const REPO = path.join(__dirname, '..', '..');",
    'function relativeTo(root, p) { return path.relative(root, p); }',
    'relativeTo(REPO, "x");',
  ].join('\n');
  assert.equal(liveRepoDerivation(text), null);
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

// The architect's standing requirement from SEND BACK #2, made executable:
// the clean scan must stop passing VACUOUSLY with respect to the four files
// this ticket was minted to fix. Green here previously meant "the guard cannot
// see them", which is indistinguishable from "they are fine" unless something
// asserts the difference. Strip each file's exemption and the guard must name
// it - so if a later change makes the scan blind again, this goes red rather
// than the tree quietly reporting [].
test('BL-1038 D1: the four headline files are genuinely REACHED - remove the exemption and each is a violation', () => {
  const fs = require('node:fs');
  const named = [
    'renderBriefingDiagramsCli.test.js',
    'renderBriefingBurndownCli.test.js',
    'briefingDigestLineCli.test.js',
    'emitLifecycleSnapshotCli.test.js',
  ];
  const unreached = [];
  for (const file of named) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(exemptionReason(text), `${file} must carry a recorded exemption reason`);
    const withoutExemption = text.replace(/BL-1038-EXEMPT:/g, 'BL-1038-WAS-EXEMPT:');
    if (!violationFor(file, withoutExemption)) unreached.push(file);
  }
  assert.deepEqual(
    unreached,
    [],
    'the guard cannot see these files at all, so a clean scan says nothing about them:\n  ' + unreached.join('\n  ')
  );
});

test('BL-1038: the real extension/test tree has no unjustified live-repository derivation', () => {
  const violations = findLiveRepoDerivations(path.join(__dirname));
  assert.deepEqual(violations, [],
    'every live-repository derivation must read a pinned fixture or record why it cannot:\n' +
      violations.map((v) => `  ${v.file}: ${v.reason}`).join('\n')
  );
});
