'use strict';

// BL-1459's two declared invariants (coder first authorship - BL-654):
//
// Invariant 1: "A day has at most one landed briefing: no land through
// this guard ever replaces or adds a second docs/briefings/<date>.md for
// a date the landed main already carries." Encoded directly against the
// real check_documenter_briefing_tip.sh --tip mode over a generated
// spread of (landed date, tip date, landed content, tip content) -
// proving the refusal is keyed on the DATE (same date always refused,
// regardless of byte content; a different date is never refused by this
// rule) never a reimplementation of the git-object comparison.
//
// Invariant 2: "The guard judges only a documenter-side incoming commit;
// a merge whose incoming parent is not reachable from the documenter
// branch, or is already reachable from the landed main, exits 0 without
// judging (BL-1444 invariant 2)." Encoded against the real guard's hook
// mode over a generated spread of (is the incoming commit on the
// documenter branch, is it already landed) - proving hook mode judges
// (and can therefore refuse) in exactly the one quadrant the invariant
// names, and silently exits 0 in the other three.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_documenter_briefing_tip.sh');
const DOC_BRANCH = 'swarmforge-documenter';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function initRepo(root) {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  git(root, ['branch', DOC_BRANCH, 'main']);
}

// BL-1666: a monotonic counter, embedded in every commit message, so two
// commits are never byte-identical git objects even when they write the
// SAME path with the SAME content from the SAME parent - a real draw
// shape here, since landedContent and tipContent are independently
// generated strings that DO sometimes collide. Without this, main's and
// the documenter's commit (same tree, same parent, same message, same
// author/committer second) hash to the SAME sha, so "the documenter
// branch" silently collapses onto "main" - every diff-based check then
// diffs a commit against itself, resolves an empty change, and reads as
// a no-op. This was invariant 1's own flake (QA's 1-in-17 sighting,
// 2090-01-01 with byte-identical content on both sides): reproduced
// deterministically, seed 1875229817, at draw 4911 of a 10,000-draw
// bounded search (extension/bl1666-invariant1-10k-search.js, not
// committed - see backlog/evidence/BL-1666-*.md). Not a defect in
// check_documenter_briefing_tip.sh: the guard reasons about git objects
// correctly; the fixture's own commit-identity guarantee was the gap.
let commitSequence = 0;
function writeCommit(root, branch, files) {
  git(root, ['checkout', '-q', branch]);
  for (const [relPath, content] of files) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    git(root, ['add', relPath]);
  }
  commitSequence += 1;
  git(root, ['commit', '-q', '-m', `change: ${files.map((f) => f[0]).join(' ')} (#${commitSequence})`]);
}

function runGuard(root, args) {
  const result = spawnSync('bash', [GUARD, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ── Invariant 1 ──────────────────────────────────────────────────────────

const dateArbitrary = fc
  .tuple(fc.integer({ min: 2090, max: 2098 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

test(
  'property (BL-1459 invariant 1): a briefing for the landed date is always refused regardless of content; a different date is never refused by this rule',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(
        fc.tuple(dateArbitrary, dateArbitrary).filter(([a, b]) => a !== b),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.boolean(),
        (dates, landedContent, tipContent, sameDate) => {
          draws += 1;
          const [landedDate, otherDate] = dates;
          const tipDate = sameDate ? landedDate : otherDate;
          const root = mkTmpDir('bl1459-invariant1-');
          initRepo(root);
          writeCommit(root, 'main', [[`docs/briefings/${landedDate}.md`, landedContent]]);
          writeCommit(root, DOC_BRANCH, [[`docs/briefings/${tipDate}.md`, tipContent]]);
          const tip = git(root, ['rev-parse', 'HEAD']);
          git(root, ['checkout', '-q', 'main']);
          const { status, stdout, stderr } = runGuard(root, ['--tip', tip, '--branch', DOC_BRANCH]);
          const combined = stdout + stderr;
          if (sameDate) {
            assert.equal(status, 1, `expected refusal for the already-landed date ${landedDate}, got status ${status}: ${combined}`);
            assert.ok(combined.includes(landedDate), `expected the refusal to name ${landedDate}, got: ${combined}`);
            assert.match(combined, /already on main/);
          } else {
            assert.equal(status, 0, `expected OK for a distinct date ${tipDate} (landed carries ${landedDate}), got status ${status}: ${combined}`);
            assert.match(combined, /DOCUMENTER_BRIEFING_TIP_OK/);
          }
        }
      ),
      { numRuns: 12 }
    );
    assert.ok(draws >= 8);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1459 invariant 1) non-vacuity: a broken already-landed check would OK a re-send - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(GUARD, 'utf8');
  const marker = 'if already_landed_day "$LANDED_MAIN" "$DATE"; then\n    refuse_direct "docs/briefings/${DATE}.md already on main"\n  fi\n';
  assert.ok(original.includes(marker), 'expected to find the direct-mode already-landed-day check to remove for the non-vacuity probe');
  const broken = original.replace(marker, '');
  assert.notEqual(broken, original, 'expected the textual removal to actually change the file');

  const brokenPath = path.join(path.dirname(GUARD), `check_documenter_briefing_tip-non-vacuity-scratch-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o755 });
  const root = mkTmpDir('bl1459-non-vacuity-');
  try {
    initRepo(root);
    writeCommit(root, 'main', [['docs/briefings/2097-05-05.md', 'original']]);
    writeCommit(root, DOC_BRANCH, [['docs/briefings/2097-05-05.md', 'a resend']]);
    const tip = git(root, ['rev-parse', 'HEAD']);
    git(root, ['checkout', '-q', 'main']);
    const result = spawnSync('bash', [brokenPath, '--tip', tip, '--branch', DOC_BRANCH], { cwd: root, encoding: 'utf8' });
    assert.equal(
      result.status,
      0,
      `expected the broken (already-landed check removed) guard to wrongly OK a re-send of the same date, got status ${result.status}: ${result.stdout}${result.stderr}`
    );
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});

// BL-1666: deterministic regression for QA's own 1-in-17 sighting
// (evidence unowned-red-bl1459-property-test-flaky-not-deterministic-20260920.md),
// reproduced with a mechanism via a 10,000-draw bounded search (seed
// 1875229817, draw 4911: dates ["2090-01-01","2090-01-02"], landedContent
// "#", tipContent "#", sameDate true). NOT a defect in
// check_documenter_briefing_tip.sh: main's and the documenter's commit
// (same tree, same parent, same message, same author/committer second)
// hashed to the SAME git object, silently collapsing "the documenter
// branch" onto "main" - every diff-based check then diffed a commit
// against itself and read a no-op. writeCommit's own commit-sequence
// counter (above) fixes the fixture; this pins the exact collision shape
// so a future edit to writeCommit cannot reintroduce it invisibly.
test('property (BL-1459 invariant 1) regression: byte-identical content on the same date still refuses (BL-1666, was the flake)', () => {
  const root = mkTmpDir('bl1459-identical-content-');
  initRepo(root);
  writeCommit(root, 'main', [['docs/briefings/2090-01-01.md', '#']]);
  writeCommit(root, DOC_BRANCH, [['docs/briefings/2090-01-01.md', '#']]);
  const tip = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'main']);
  const { status, stdout, stderr } = runGuard(root, ['--tip', tip, '--branch', DOC_BRANCH]);
  const combined = stdout + stderr;
  assert.equal(status, 1, `expected refusal for byte-identical content on an already-landed date, got status ${status}: ${combined}`);
  assert.match(combined, /already on main/);
});

// ── Invariant 2 ──────────────────────────────────────────────────────────

// 2026-09-20 (specifier ruling, spec-gap bounce): the declared invariant's
// own wording now names the distinction directly - "one on the documenter
// branch's first-parent line... an incoming parent the documenter branch
// reached only through a merge's second parent (an upstream chain commit)
// ... exits 0 without judging." A plain documenter-side/not boolean (this
// test's own pre-ruling shape) cannot tell first-parent membership from
// mere reachability, since neither of ITS two branches ever puts the
// incoming commit behind a second parent - it would have passed against
// the coder's own superseded ancestry-based check just as well. `shape`
// generates all three: a plain documenter commit (first-parent, must be
// judged), a chain-second-parent commit (reachable but must NOT be judged
// - this ticket's own live incident), and an unrelated role's commit
// (not reachable at all).
const SHAPES = ['plain-documenter', 'chain-second-parent', 'other-role'];

// 2026-09-20 CRITICAL fix (QA note 003000, specifier ruling): the
// declared invariant's own wording also names "an ordinary documenter
// forward that changes no briefing file" as a case that must exit 0 -
// the hook runs from the MERGED tree, so this guard's own parcel
// enforces itself on the very merge that delivers it, and the documenter
// mostly sends ordinary parcel forwards, never a briefing land.
// touchesBriefing is only meaningful for shape='plain-documenter' (the
// other two shapes already exit 0 before the content trigger is ever
// reached); generated uniformly regardless so every (shape,
// touchesBriefing) pair is exercised without a filter.
function buildIncoming(root, shape, touchesBriefing) {
  if (shape === 'plain-documenter') {
    const files = [['extension/src/thing.ts', 'x']];
    if (touchesBriefing) {
      files.push(['docs/briefings/2099-03-03.md', 'y']);
    }
    writeCommit(root, DOC_BRANCH, files);
    return git(root, ['rev-parse', 'HEAD']);
  }
  // 'other-role' and 'chain-second-parent' both touch docs/briefings/ too
  // (never gated by touchesBriefing, unlike plain-documenter) - they must
  // exit 0 via the reachability/first-parent checks specifically, not
  // merely because the content trigger also would have skipped them; the
  // non-vacuity tests below rely on that to isolate each check in turn.
  if (shape === 'other-role') {
    git(root, ['branch', 'other-role', 'main']);
    writeCommit(root, 'other-role', [
      ['extension/src/thing.ts', 'x'],
      ['docs/briefings/2099-03-04.md', 'y'],
    ]);
    return git(root, ['rev-parse', 'HEAD']);
  }
  // chain-second-parent: cleaner -> architect -> hardener -> documenter,
  // the exact ordinary chain BL-1459's own incident rode in on.
  git(root, ['branch', 'cleaner_branch', 'main']);
  writeCommit(root, 'cleaner_branch', [
    ['extension/src/thing.ts', 'x'],
    ['docs/briefings/2099-03-05.md', 'y'],
  ]);
  const cleanerTip = git(root, ['rev-parse', 'cleaner_branch']);
  git(root, ['checkout', '-q', '-b', 'architect_branch', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-m', 'Merge cleaner into architect', 'cleaner_branch']);
  git(root, ['checkout', '-q', '-b', 'hardener_branch', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-m', 'Merge architect into hardener', 'architect_branch']);
  git(root, ['checkout', '-q', DOC_BRANCH]);
  git(root, ['merge', '-q', '--no-ff', '-m', 'Merge hardener into documenter', 'hardener_branch']);
  return cleanerTip;
}

test(
  'property (BL-1459 invariant 2): hook mode judges (and can refuse) only a first-parent, not-yet-landed, briefing-touching documenter commit',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom(...SHAPES), fc.boolean(), fc.boolean(), (shape, isAlreadyLanded, touchesBriefing) => {
        draws += 1;
        const root = mkTmpDir('bl1459-invariant2-');
        initRepo(root);
        const incomingSha = buildIncoming(root, shape, touchesBriefing);

        if (isAlreadyLanded) {
          git(root, ['checkout', '-q', 'main']);
          git(root, ['merge', '-q', '--no-ff', '-m', 'land it first', incomingSha]);
          git(root, ['checkout', '-q', '-b', 'landing', 'main']);
          spawnSync('git', ['merge', '--no-ff', '--no-commit', incomingSha], { cwd: root });
        } else {
          git(root, ['checkout', '-q', '-b', 'landing', 'main']);
          spawnSync('git', ['merge', '--no-ff', '--no-commit', incomingSha], { cwd: root });
        }

        const { status, stdout, stderr } = runGuard(root, ['--branch', DOC_BRANCH]);
        spawnSync('git', ['merge', '--abort'], { cwd: root });

        // Judged (refused: extension/src/thing.ts is out of lane) only for
        // a plain, first-parent documenter commit that is not already
        // landed AND touches docs/briefings/; every other combination
        // (including an ordinary plain-documenter forward that never
        // touches a briefing file) exits 0 without judging.
        const shouldJudge = shape === 'plain-documenter' && !isAlreadyLanded && touchesBriefing;
        if (shouldJudge) {
          assert.equal(status, 1, `expected the guard to judge (and refuse the out-of-lane path) for shape=${shape} alreadyLanded=${isAlreadyLanded} touchesBriefing=${touchesBriefing}, got status ${status}: ${stdout}${stderr}`);
        } else {
          assert.equal(
            status,
            0,
            `expected exit 0 without judging (shape=${shape}, alreadyLanded=${isAlreadyLanded}, touchesBriefing=${touchesBriefing}), got status ${status}: ${stdout}${stderr}`
          );
        }
      }),
      { numRuns: 18 }
    );
    assert.ok(draws >= 12);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1459 invariant 2) non-vacuity: a broken first-parent-membership check would judge every merge, even a non-documenter one - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(GUARD, 'utf8');
  const marker =
    'FIRST_PARENT_LIST="$(git rev-list --first-parent "${LANDED_MAIN}..${DOCUMENTER_BRANCH}" 2>/dev/null || true)"\nif ! grep -qx "$INCOMING" <<<"$FIRST_PARENT_LIST"; then\n  exit 0\nfi\n';
  assert.ok(original.includes(marker), 'expected to find the hook-mode first-parent-membership check to remove for the non-vacuity probe');
  const broken = original.replace(marker, '');
  assert.notEqual(broken, original, 'expected the textual removal to actually change the file');

  const brokenPath = path.join(path.dirname(GUARD), `check_documenter_briefing_tip-non-vacuity-scratch2-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o755 });
  const root = mkTmpDir('bl1459-non-vacuity2-');
  try {
    initRepo(root);
    git(root, ['branch', 'other-role', 'main']);
    // Touches docs/briefings/ too (unlike a truly ordinary commit) so this
    // probe isolates the first-parent-membership check alone - the
    // content-trigger check must not also account for the exit-0 result.
    writeCommit(root, 'other-role', [
      ['extension/src/thing.ts', 'x'],
      ['docs/briefings/2099-03-06.md', 'y'],
    ]);
    const incomingSha = git(root, ['rev-parse', 'HEAD']);
    const early = git(root, ['rev-parse', 'main']);
    git(root, ['checkout', '-q', '-b', 'landing', early]);
    spawnSync('git', ['merge', '--no-ff', '--no-commit', incomingSha], { cwd: root });
    const result = spawnSync('bash', [brokenPath, '--branch', DOC_BRANCH], { cwd: root, encoding: 'utf8' });
    spawnSync('git', ['merge', '--abort'], { cwd: root });
    assert.equal(
      result.status,
      1,
      `expected the broken (reachability check removed) guard to wrongly judge (and refuse) a non-documenter merge, got status ${result.status}: ${result.stdout}${result.stderr}`
    );
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});

test('property (BL-1459 invariant 2) non-vacuity: plain ancestry (the superseded design) would wrongly judge a chain-second-parent commit - this ticket\'s own live incident, reproduced then discarded', () => {
  const original = fs.readFileSync(GUARD, 'utf8');
  const marker =
    'FIRST_PARENT_LIST="$(git rev-list --first-parent "${LANDED_MAIN}..${DOCUMENTER_BRANCH}" 2>/dev/null || true)"\nif ! grep -qx "$INCOMING" <<<"$FIRST_PARENT_LIST"; then\n  exit 0\nfi\n';
  assert.ok(original.includes(marker), 'expected to find the hook-mode first-parent-membership check to replace for this probe');
  // The naive replacement is exactly check_art_director_tip.sh's own
  // pattern (plain ancestry) - the design this ticket's incident showed
  // is wrong for a CHAIN role, not a strawman.
  const naiveAncestry = 'if ! git merge-base --is-ancestor "$INCOMING" "$DOCUMENTER_BRANCH" 2>/dev/null; then\n  exit 0\nfi\n';
  const broken = original.replace(marker, naiveAncestry);
  assert.notEqual(broken, original, 'expected the textual replacement to actually change the file');

  const brokenPath = path.join(path.dirname(GUARD), `check_documenter_briefing_tip-non-vacuity-scratch3-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o755 });
  const root = mkTmpDir('bl1459-non-vacuity3-');
  try {
    initRepo(root);
    const chainCommit = buildIncoming(root, 'chain-second-parent');
    git(root, ['checkout', '-q', '-b', 'landing', 'main']);
    spawnSync('git', ['merge', '--no-ff', '--no-commit', chainCommit], { cwd: root });
    const result = spawnSync('bash', [brokenPath, '--branch', DOC_BRANCH], { cwd: root, encoding: 'utf8' });
    spawnSync('git', ['merge', '--abort'], { cwd: root });
    assert.equal(
      result.status,
      1,
      `expected the naive-ancestry guard to wrongly judge (and refuse) the chain-second-parent commit - reproducing this ticket's own incident - got status ${result.status}: ${result.stdout}${result.stderr}`
    );
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});

test('property (BL-1459 invariant 2) non-vacuity: a broken content trigger would judge every ordinary documenter forward - CRITICAL fix (QA note 003000), reproduced then discarded', () => {
  const original = fs.readFileSync(GUARD, 'utf8');
  const marker =
    'INCOMING_DIFF_PATHS="$(git diff --name-only "$BASE" "$INCOMING" 2>/dev/null || true)"\nif ! grep -q "^${BRIEFINGS_DIR}" <<<"$INCOMING_DIFF_PATHS"; then\n  exit 0\nfi\n';
  assert.ok(original.includes(marker), 'expected to find the hook-mode content-trigger check to remove for this probe');
  const broken = original.replace(marker, '');
  assert.notEqual(broken, original, 'expected the textual removal to actually change the file');

  const brokenPath = path.join(path.dirname(GUARD), `check_documenter_briefing_tip-non-vacuity-scratch4-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o755 });
  const root = mkTmpDir('bl1459-non-vacuity4-');
  try {
    initRepo(root);
    // An ordinary forward: first-parent, not-yet-landed, but touches NO
    // briefing file at all - exactly QA's own CRITICAL incident shape.
    writeCommit(root, DOC_BRANCH, [['extension/src/some_feature.ts', 'x']]);
    const ordinaryTip = git(root, ['rev-parse', 'HEAD']);
    git(root, ['checkout', '-q', '-b', 'landing', 'main']);
    spawnSync('git', ['merge', '--no-ff', '--no-commit', ordinaryTip], { cwd: root });
    const result = spawnSync('bash', [brokenPath, '--branch', DOC_BRANCH], { cwd: root, encoding: 'utf8' });
    spawnSync('git', ['merge', '--abort'], { cwd: root });
    assert.equal(
      result.status,
      1,
      `expected the broken (content-trigger removed) guard to wrongly judge (and refuse) an ordinary documenter forward, got status ${result.status}: ${result.stdout}${result.stderr}`
    );
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});
