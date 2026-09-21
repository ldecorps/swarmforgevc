'use strict';

// BL-1671's declared invariant (coder first authorship, BL-654):
//
// "During a merge commit the guard's deletion set is the index against
// each parent, never the working tree: an unstaged working-tree change
// can neither add nor remove a finding, and the merge leaves it exactly
// as it found it." Encoded against the real check_merge_deletion.sh,
// wired as the real commit-msg hook, over a generated spread of (does the
// commit message name the ticket for a real, committed deletion; is an
// UNRELATED tracked path also deleted on disk but never staged) - proving
// the guard's verdict (refused/allowed, and which path it names) depends
// only on the committed (indexed) change, never on the unstaged noise,
// and that the noise path is left exactly as the merge found it
// (untouched by the commit, still unstaged-deleted afterwards).
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
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_merge_deletion.sh');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function gitEnv(root, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' }).trim();
}

// Builds: main carries core.txt (BL-9001) and noise.txt (unrelated,
// untouched by either branch's own history); "other" branch commits a
// removal of core.txt, subject naming no ticket (deliberate - the
// message under test is what the merge commit itself carries, not the
// deleting commit's own subject).
function buildFixture(root) {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'core.txt'), 'core\n');
  fs.writeFileSync(path.join(root, 'noise.txt'), 'noise\n');
  git(root, ['add', 'core.txt', 'noise.txt']);
  gitEnv(root, ['commit', '-q', '-m', 'BL-9001: add core.txt and noise.txt']);
  const base = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', '-b', 'other', base]);
  git(root, ['rm', '-q', 'core.txt']);
  gitEnv(root, ['commit', '-q', '-m', 'chore: drop core.txt']);

  git(root, ['checkout', '-q', 'main']);
}

function runMergeCommitMsgHook(root, message) {
  // The guard fires from commit-msg, not pre-commit - invoke it exactly as
  // the hook does: the commit-msg file's contents as $1, in a merge in
  // progress (MERGE_HEAD present).
  const msgFile = path.join(root, '.git', 'COMMIT_EDITMSG_TEST');
  fs.writeFileSync(msgFile, message);
  const result = spawnSync('bash', [GUARD, msgFile], { cwd: root, encoding: 'utf8' });
  fs.rmSync(msgFile, { force: true });
  return result;
}

test(
  'property (BL-1671 invariant): the guard verdict depends only on the indexed (committed) change, never an unrelated unstaged working-tree deletion',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (ticketNamed, unstagedNoise) => {
        draws += 1;
        const root = mkTmpDir('bl1671-invariant-');
        buildFixture(root);
        spawnSync('git', ['merge', '--no-ff', '--no-commit', 'other'], { cwd: root });
        if (unstagedNoise) {
          fs.unlinkSync(path.join(root, 'noise.txt'));
        }
        const message = ticketNamed ? 'BL-9001: propagate the removal' : 'merge, no ticket named';
        const result = runMergeCommitMsgHook(root, message);
        const combined = (result.stdout || '') + (result.stderr || '');

        if (ticketNamed) {
          assert.equal(result.status, 0, `expected exit 0 (ticket named) regardless of unstagedNoise=${unstagedNoise}, got status ${result.status}: ${combined}`);
        } else {
          assert.notEqual(result.status, 0, `expected refusal (no ticket named) regardless of unstagedNoise=${unstagedNoise}, got status ${result.status}`);
          assert.match(combined, /core\.txt/, `expected the refusal to name core.txt, got: ${combined}`);
        }
        // The unrelated unstaged deletion is NEVER a finding, whichever way
        // the real deletion resolves.
        assert.doesNotMatch(combined, /noise\.txt/, `expected noise.txt never named by the guard, got: ${combined}`);

        if (unstagedNoise) {
          const status = git(root, ['status', '--short', '--', 'noise.txt']);
          assert.match(status, /^\s*D\s+noise\.txt/, `expected noise.txt to remain an untouched unstaged deletion, got: ${status}`);
        }
      }),
      { numRuns: 12 }
    );
    assert.ok(draws >= 8);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1671 invariant) non-vacuity: without --cached, an unrelated unstaged deletion becomes a false finding - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(GUARD, 'utf8');
  const marker = 'done < <(git diff --cached --name-status -M "$against")\n';
  assert.ok(original.includes(marker), 'expected to find the --cached collect_deletions read to remove for the non-vacuity probe');
  const broken = original.replace(marker, 'done < <(git diff --name-status -M "$against")\n');
  assert.notEqual(broken, original, 'expected the textual replacement to actually change the file');

  const brokenPath = path.join(path.dirname(GUARD), `check_merge_deletion-non-vacuity-scratch-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o755 });
  const root = mkTmpDir('bl1671-non-vacuity-');
  try {
    buildFixture(root);
    spawnSync('git', ['merge', '--no-ff', '--no-commit', 'other'], { cwd: root });
    fs.unlinkSync(path.join(root, 'noise.txt'));
    const msgFile = path.join(root, '.git', 'COMMIT_EDITMSG_TEST');
    // Deliberately unnamed, so a fixed guard's own legitimate refusal of
    // core.txt does not mask the false positive under test: the signal is
    // whether noise.txt - an unrelated, never-committed-deleted path - is
    // ALSO named, which only the working-tree read (the bug) would do.
    fs.writeFileSync(msgFile, 'merge, no ticket named');
    const result = spawnSync('bash', [brokenPath, msgFile], { cwd: root, encoding: 'utf8' });
    fs.rmSync(msgFile, { force: true });
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.notEqual(result.status, 0, `expected a refusal (core.txt alone would already trigger one), got status ${result.status}: ${combined}`);
    assert.match(combined, /noise\.txt/, `expected the broken guard's false finding to ALSO name the unrelated, unstaged-only noise.txt, got: ${combined}`);
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});
