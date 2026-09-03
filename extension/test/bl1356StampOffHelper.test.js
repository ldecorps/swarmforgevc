'use strict';

// BL-1356: the proof that scoping the stamp-off assertion did not SOFTEN it.
//
// The ticket's own warning is that "a fix that makes these tests pass by
// asserting less is the failure mode to avoid", and its qa_e2e step 4 asks for
// exactly this: a run that writes a decision MID-RUN must still fail, from any
// starting state. That cannot be demonstrated against the live ledger without
// writing to it, which is why the helper takes an injectable ledger path — this
// file is the only caller that uses it.
//
// A unit test, deliberately: these are pure decisions about text, and the
// declared invariants get their own property file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  assertRunWritesNoDecision,
  hotfixRow,
  findTicketYaml,
  assertParcelDoesNotEditReviewedSources,
} = require('./helpers/stampOff');

const HOTFIX = 'abc1234567';

// The neighbours are DECIDED rows, deliberately: a helper that matched the
// whole file rather than the watched row would read their verdicts as this
// row's, and every "still fails" row below would pass for the wrong reason.
// It also keeps each field literal unique to the row under test, so a fixture
// edit lands where the test says it does.
function ledgerWith(state, extra = '') {
  return [
    'entries:',
    '- commit: 0000000000',
    '  state: certified',
    '  human_decision: certified',
    '  decided_at: 2026-01-01',
    `- commit: ${HOTFIX}`,
    `  state: ${state}`,
    '  stamp_ticket: BL-9999',
    '  human_decision: null',
    '  decided_at: null',
    extra,
    '- commit: ffffffffff',
    '  state: waived',
    '',
  ].filter((l) => l !== '').join('\n');
}

function fixture(state) {
  const dir = mkTmpDir('bl1356-ledger-');
  const file = path.join(dir, 'hotfix-ledger.yaml');
  fs.writeFileSync(file, ledgerWith(state));
  return file;
}

const opts = (file) => ({ ledgerPath: file });

// ── invariant 1: a row that legitimately advanced is not a violation ──────
for (const state of ['stamp-open', 'pending', 'awaiting-human']) {
  test(`a row sitting at ${state} passes when the run writes nothing`, () => {
    const file = fixture(state);
    assert.doesNotThrow(() => assertRunWritesNoDecision(HOTFIX, () => {}, opts(file)));
  });
}

// The strongest form of invariant 1: even a row that ALREADY carries a decided
// state passes, because a value the row held before the run is not evidence
// about what the run wrote. This is the case a state-literal pin got wrong in
// both directions.
test('a row already decided by a human passes when the run writes nothing', () => {
  const file = fixture('certified');
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('human_decision: null', 'human_decision: certified')
  );
  assert.doesNotThrow(() => assertRunWritesNoDecision(HOTFIX, () => {}, opts(file)));
});

// ── invariant 2: scoping never weakens — a write still fails ─────────────
function writeDuringRun(file, from, to) {
  return () => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to));
}

for (const [label, from, to, expected] of [
  ['a decided state', `state: stamp-open`, 'state: certified', /wrote a decision into .* state/],
  ['a waiver', `state: stamp-open`, 'state: waived', /wrote a decision into .* state/],
  ['a human_decision', 'human_decision: null', 'human_decision: certified', /wrote a decision into .* human_decision/],
  ['a decision timestamp', 'decided_at: null', 'decided_at: 2026-09-03', /wrote a decision into .* decided_at/],
]) {
  test(`a run that writes ${label} still fails`, () => {
    const file = fixture('stamp-open');
    assert.throws(
      () => assertRunWritesNoDecision(HOTFIX, writeDuringRun(file, from, to), opts(file)),
      expected
    );
  });
}

// From ANY starting state, which is the half the ticket names explicitly.
for (const state of ['stamp-open', 'pending', 'awaiting-human']) {
  test(`a run that stamps a decision fails from a row at ${state}`, () => {
    const file = fixture(state);
    assert.throws(
      () => assertRunWritesNoDecision(HOTFIX, writeDuringRun(file, `state: ${state}`, 'state: certified'), opts(file)),
      /wrote a decision/
    );
  });
}

// Any other write to the watched row is a violation too — the invariant is
// non-mutation across the run, not merely "no decision".
test('a run that edits the row in any other way still fails', () => {
  const file = fixture('stamp-open');
  assert.throws(
    () => assertRunWritesNoDecision(HOTFIX, writeDuringRun(file, 'stamp_ticket: BL-9999', 'stamp_ticket: BL-0000'), opts(file)),
    /changed .*hotfix-ledger row/
  );
});

// A write to a DIFFERENT row is still a change to the file, and the helper says
// so — a suite that writes anywhere in the ledger has written to the ledger.
test('a run that edits another row fails on the file, naming it', () => {
  const file = fixture('stamp-open');
  assert.throws(
    () => assertRunWritesNoDecision(HOTFIX, writeDuringRun(file, '  state: waived', '  state: pending'), opts(file)),
    /changed hotfix-ledger\.yaml/
  );
});

// ── the watched row must exist: an invariant watching nothing passes forever ─
test('a hotfix with no row is an error, never a silent pass', () => {
  const file = fixture('stamp-open');
  assert.throws(() => assertRunWritesNoDecision('deadbeef00', () => {}, opts(file)), /no hotfix-ledger row/);
});

test('hotfixRow stops at the next entry rather than swallowing the rest', () => {
  const row = hotfixRow(ledgerWith('pending'), HOTFIX);
  assert.match(row, /stamp_ticket: BL-9999/);
  assert.doesNotMatch(row, /ffffffffff/);
});

// ── a ticket's folder is its state, so only its id is stable ─────────────
test('findTicketYaml locates a ticket wherever its workflow has moved it', () => {
  const found = findTicketYaml('BL-1136');
  assert.match(found, /BL-1136-.*\.yaml$/);
  assert.ok(fs.existsSync(found));
});

test('findTicketYaml fails loudly for a ticket that does not exist', () => {
  assert.throws(() => findTicketYaml('BL-000000'), /no ticket yaml/);
});

// ── assertParcelDoesNotEditReviewedSources (hardener-found gap) ──────────
// Zero direct test coverage before this pass: only exercised incidentally by
// the family files running against THIS repo's real history, where
// `origin/main..HEAD` frequently contains no commit naming the ticket at
// all - the early-return path - so the substantive assertion could go
// untested indefinitely. A hand-mutation sweep over stampOff.js found two
// survivors here: dropping `--first-parent` and inverting `includes()`.
// Both are closed with a real git fixture below.
function gitFixture() {
  const dir = mkTmpDir('bl1356-git-fixture-');
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'reviewed.txt'), 'reviewed\n');
  fs.writeFileSync(path.join(dir, 'other.txt'), 'other\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  git('branch', '-f', 'origin/main', 'HEAD');
  return { dir, git };
}

test('no commit naming the ticket in range: returns empty, never throws', () => {
  const { dir, git } = gitFixture();
  fs.writeFileSync(path.join(dir, 'other.txt'), 'unrelated change\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'BL-0000: unrelated ticket, does not name our ticket');
  const result = assertParcelDoesNotEditReviewedSources('BL-9999', ['reviewed.txt'], { repoRoot: dir });
  assert.deepEqual(result, { commits: [], changed: [] });
});

test('a commit naming the ticket that does not touch the reviewed path passes', () => {
  const { dir, git } = gitFixture();
  fs.writeFileSync(path.join(dir, 'other.txt'), 'touched by the review\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'BL-9999: stamp-off review, touches only other.txt');
  assert.doesNotThrow(() =>
    assertParcelDoesNotEditReviewedSources('BL-9999', ['reviewed.txt'], { repoRoot: dir })
  );
});

test('a commit naming the ticket that DOES touch the reviewed path fails, naming it', () => {
  const { dir, git } = gitFixture();
  fs.writeFileSync(path.join(dir, 'reviewed.txt'), 'edited by the review\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'BL-9999: stamp-off review, but rewrites reviewed.txt');
  assert.throws(
    () => assertParcelDoesNotEditReviewedSources('BL-9999', ['reviewed.txt'], { repoRoot: dir }),
    /BL-9999 stamp-off parcel edits reviewed\.txt/
  );
});

// The --first-parent mutant. Measured directly before writing this test
// (git's own behavior, not assumed): `git show <merge>` with NO diff option
// defaults to a COMBINED diff, which shows nothing here because the merge
// result matches the side branch's content exactly - no conflict, no
// divergence from either parent to report. `--first-parent` instead diffs
// the merge result against its FIRST parent alone, which DOES show
// reviewed.txt as changed, because relative to main-before-the-merge, the
// content did change - exactly what BL-1354's own investigation found
// ("a merge's first-parent diff is everything its second parent brought
// in"). So --first-parent here is the STRONGER, more cautious check: a
// review parcel whose merge silently carries in someone else's edit to a
// reviewed path must still be flagged, and dropping --first-parent would
// let it through via the empty combined diff.
test('a merge naming the ticket that silently carries in a reviewed-path edit is still flagged (--first-parent)', () => {
  const { dir, git } = gitFixture();
  git('checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(dir, 'reviewed.txt'), 'edited on the side branch\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'BL-0000: unrelated side-branch work touching reviewed.txt');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'BL-9999: stamp-off review merges in unrelated side work', 'side');
  assert.throws(
    () => assertParcelDoesNotEditReviewedSources('BL-9999', ['reviewed.txt'], { repoRoot: dir }),
    /BL-9999 stamp-off parcel edits reviewed\.txt/
  );
});
