'use strict';

// BL-1475's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A durability alarm (FAILED TO COMMIT, NOT yet durable) is
//                raised only when the path is still dirty against HEAD
//                after the retry budget: a change any writer's commit has
//                landed is reported as landed, never as needing manual
//                landing.
//   invariant 2  Every commit attempt is bounded (attempts x backoff at
//                most 30s), retries only a lock refusal, and logs git's
//                stderr on its final failure.
//
// Both drive the REAL compiled gitCommitScopedFile.commitScopedFile against
// a real git fixture repo (mkdtemp) - never a JavaScript restatement of the
// decision. commitScopedFile is the shared retry/verify implementation this
// ticket fixed; commit_integrity_lib.bb (the front desk's own mechanism)
// mirrors the identical shape and is proven deterministically in
// swarmforge/scripts/test/commit_integrity_lib_test_runner.bb (no
// established bb-level property-testing convention exists in this
// codebase - every *.property.test.js precedent, BL-654 through BL-1343,
// targets the TypeScript side).
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). Invariant 1's
// defect lives in exactly the corner where an attempt FAILS but the content
// is nonetheless durable - drawing "does it eventually resolve" and "how"
// independently of "does resolution actually land the exact content" would
// let a mutant that always alarms on any failure pass rarely (whenever the
// draw happened to pick "never resolves"). Instead every one of the three
// resolution shapes (own retry succeeds, another writer lands it first,
// never resolves) is its own arm, constructed to reach the corner by
// construction: the "another writer" arm's fake attemptCommit performs a
// REAL git commit of the caller's own exact content on the attempt AFTER
// the drawn failure count, so the corner (a failed attempt, durable
// content) is reached on every run of that arm, not by chance.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { commitScopedFile } = require('../out/util/gitCommitScopedFile');

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkGitRepo() {
  const dir = mkTmpDir('sfvc-bl1475-prop-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return dir;
}

function porcelainStatus(dir, filePath) {
  return git(dir, ['status', '--porcelain', '--', filePath]).trim();
}

const LOCK_STDERR = "fatal: Unable to create '.git/index.lock': File exists.";

test('BL-1475 invariant 1: a durability alarm is raised only when the path is still dirty after the retry budget', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 8 }),
      fc.constantFrom('own-retry-succeeds', 'another-writer-lands-it', 'never-resolves'),
      (failuresBeforeResolution, resolution) => {
        const target = mkGitRepo();
        const filePath = path.join(target, 'tracked.txt');
        fs.writeFileSync(filePath, 'content');
        let calls = 0;
        const attemptCommit = () => {
          calls += 1;
          if (resolution !== 'never-resolves' && calls > failuresBeforeResolution) {
            if (resolution === 'own-retry-succeeds') {
              git(target, ['add', '--', filePath]);
              git(target, ['commit', '-q', '-m', 'landed by this call', '--', filePath]);
              return { committed: true };
            }
            // 'another-writer-lands-it': a DIFFERENT writer commits the
            // exact same content the caller wrote, out of band - this
            // call's OWN attempt still fails (a real, non-lock failure:
            // there is genuinely nothing left for IT to commit).
            git(target, ['add', '--', filePath]);
            git(target, ['commit', '-q', '-m', 'landed by another writer', '--', filePath]);
            return { committed: false, retryable: false, stderr: 'nothing to commit, working tree clean' };
          }
          return { committed: false, retryable: true, stderr: LOCK_STDERR };
        };

        const result = commitScopedFile(target, filePath, 'msg', attemptCommit, () => {}, 12);
        const dirty = porcelainStatus(target, filePath) !== '';

        if (resolution === 'never-resolves') {
          assert.equal(dirty, true, 'test setup: content must genuinely never land in this arm');
          assert.equal(result, false, 'a path still dirty against HEAD must report failure, never a false success');
        } else {
          assert.equal(dirty, false, 'test setup: content must genuinely be durable in this arm');
          assert.equal(result, true, 'a durable path (landed by this call OR by another writer) must never alarm');
        }
      }
    ),
    { numRuns: 30 }
  );
});

test('BL-1475 invariant 2: every commit attempt is bounded, retries only a lock refusal, and logs stderr on final failure', () => {
  fc.assert(
    fc.property(fc.boolean(), (isLockRefusal) => {
      const target = mkGitRepo();
      const filePath = path.join(target, 'tracked.txt');
      fs.writeFileSync(filePath, 'content');
      let calls = 0;
      const attemptCommit = () => {
        calls += 1;
        return { committed: false, retryable: isLockRefusal, stderr: isLockRefusal ? LOCK_STDERR : 'hook declined' };
      };
      const delays = [];
      let reportedDetail;
      const result = commitScopedFile(target, filePath, 'msg', attemptCommit, (ms) => delays.push(ms), 12, (stderr) => {
        reportedDetail = stderr;
      });

      assert.equal(result, false, 'content never lands in this property - always a genuine failure');
      if (isLockRefusal) {
        assert.equal(calls, 12, 'a lock refusal that never clears must spend the FULL bounded budget');
        assert.equal(delays.length, 11, 'exactly one backoff between each of the 12 attempts');
        const totalDelayMs = delays.reduce((a, b) => a + b, 0);
        assert.ok(totalDelayMs <= 30000, `total backoff must stay within 30s, got ${totalDelayMs}ms`);
        assert.ok(delays.every((d) => d > 0), 'every backoff must be a real positive wait, never zero/flat');
      } else {
        assert.equal(calls, 1, 'a real, non-lock failure must never be retried, even once');
        assert.deepEqual(delays, [], 'no backoff wait for a non-retryable failure');
      }
      assert.ok(reportedDetail, 'gits own stderr must be reported on the final failure, never discarded');
      assert.match(reportedDetail, isLockRefusal ? /index\.lock/ : /hook declined/);
    }),
    { numRuns: 20 }
  );
});
