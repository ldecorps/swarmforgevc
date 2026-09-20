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

function writeCommit(root, branch, files) {
  git(root, ['checkout', '-q', branch]);
  for (const [relPath, content] of files) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    git(root, ['add', relPath]);
  }
  git(root, ['commit', '-q', '-m', `change: ${files.map((f) => f[0]).join(' ')}`]);
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

// ── Invariant 2 ──────────────────────────────────────────────────────────

test(
  'property (BL-1459 invariant 2): hook mode judges (and can refuse) only a documenter-side, not-yet-landed incoming commit',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (isDocumenterSide, isAlreadyLanded) => {
        draws += 1;
        const root = mkTmpDir('bl1459-invariant2-');
        initRepo(root);

        const commitBranch = isDocumenterSide ? DOC_BRANCH : 'other-role';
        if (!isDocumenterSide) {
          git(root, ['branch', 'other-role', 'main']);
        }

        let landingBase = 'main';
        if (isAlreadyLanded) {
          // Merge the commit branch's new work into main FIRST, so the
          // incoming commit is already an ancestor of landed main by the
          // time the landing branch is built from that same main tip.
          writeCommit(root, commitBranch, [['extension/src/thing.ts', 'x']]);
          const incomingSha = git(root, ['rev-parse', 'HEAD']);
          git(root, ['checkout', '-q', 'main']);
          git(root, ['merge', '-q', '--no-ff', '-m', 'land it first', commitBranch]);
          landingBase = 'main';
          git(root, ['checkout', '-q', '-b', 'landing', landingBase]);
          spawnSync('git', ['merge', '--no-ff', '--no-commit', incomingSha], { cwd: root });
        } else {
          const early = git(root, ['rev-parse', 'main']);
          writeCommit(root, commitBranch, [['extension/src/thing.ts', 'x']]);
          const incomingSha = git(root, ['rev-parse', 'HEAD']);
          git(root, ['checkout', '-q', '-b', 'landing', early]);
          spawnSync('git', ['merge', '--no-ff', '--no-commit', incomingSha], { cwd: root });
        }

        const { status, stdout, stderr } = runGuard(root, ['--branch', DOC_BRANCH]);
        spawnSync('git', ['merge', '--abort'], { cwd: root });

        // Judged (may refuse: extension/src/thing.ts is out of lane) only
        // when documenter-side AND not already landed; every other
        // quadrant exits 0 without judging.
        if (isDocumenterSide && !isAlreadyLanded) {
          assert.equal(status, 1, `expected the guard to judge (and refuse the out-of-lane path) for documenter-side, not-yet-landed, got status ${status}: ${stdout}${stderr}`);
        } else {
          assert.equal(
            status,
            0,
            `expected exit 0 without judging (documenterSide=${isDocumenterSide}, alreadyLanded=${isAlreadyLanded}), got status ${status}: ${stdout}${stderr}`
          );
        }
      }),
      { numRuns: 12 }
    );
    assert.ok(draws >= 8);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1459 invariant 2) non-vacuity: a broken branch-reachability check would judge every merge, even a non-documenter one - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(GUARD, 'utf8');
  const marker = 'if ! git merge-base --is-ancestor "$INCOMING" "$DOCUMENTER_BRANCH" 2>/dev/null; then\n  exit 0\nfi\n';
  assert.ok(original.includes(marker), 'expected to find the hook-mode branch-reachability check to remove for the non-vacuity probe');
  const broken = original.replace(marker, '');
  assert.notEqual(broken, original, 'expected the textual removal to actually change the file');

  const brokenPath = path.join(path.dirname(GUARD), `check_documenter_briefing_tip-non-vacuity-scratch2-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o755 });
  const root = mkTmpDir('bl1459-non-vacuity2-');
  try {
    initRepo(root);
    git(root, ['branch', 'other-role', 'main']);
    writeCommit(root, 'other-role', [['extension/src/thing.ts', 'x']]);
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
