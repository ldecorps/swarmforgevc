const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkTmpDir, mkSharedTmpDir, sweepPendingTmpDirs, sweepSharedTmpDirs, REMOVE_RETRY_ATTEMPTS } = require('./tmpDir');

function enotempty() {
  const err = new Error('ENOTEMPTY: directory not empty');
  err.code = 'ENOTEMPTY';
  throw err;
}

function ebusy() {
  const err = new Error('EBUSY: resource busy or locked');
  err.code = 'EBUSY';
  throw err;
}

// BL-420: the shared temp-dir helper's own tests. Never asserts on a /tmp
// LISTING (engineering shared-global-directory rule) - only on the exact
// path this helper itself created and handed back.

test('mkTmpDir creates a real directory under the given prefix', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-test-');
  assert.equal(fs.existsSync(dir), true);
  assert.match(dir, /sfvc-tmpdir-helper-test-/);
  sweepPendingTmpDirs();
});

// BL-420 test-helpers-clean-up-tmp-dirs-01
test('sweepPendingTmpDirs removes the exact directory mkTmpDir created', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-sweep-');
  assert.equal(fs.existsSync(dir), true);

  sweepPendingTmpDirs();

  assert.equal(fs.existsSync(dir), false);
});

test('sweepPendingTmpDirs removes every directory handed out since the last sweep, not just the first', () => {
  const dirA = mkTmpDir('sfvc-tmpdir-helper-multi-a-');
  const dirB = mkTmpDir('sfvc-tmpdir-helper-multi-b-');

  sweepPendingTmpDirs();

  assert.equal(fs.existsSync(dirA), false);
  assert.equal(fs.existsSync(dirB), false);
});

// BL-420 test-helpers-clean-up-tmp-dirs-02
test('sweepPendingTmpDirs removes the directory even though the body that used it "threw" (tolerant of an already-removed or still-present path either way)', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-throw-');
  try {
    throw new Error('simulated test-body failure');
  } catch {
    // swallow - the point is that mkTmpDir was called, then the body threw,
    // and the dir is STILL recorded for the next sweep regardless.
  }

  sweepPendingTmpDirs();

  assert.equal(fs.existsSync(dir), false);
});

test('sweepPendingTmpDirs tolerates a path the test already removed itself', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-already-gone-');
  fs.rmSync(dir, { recursive: true, force: true });

  assert.doesNotThrow(() => sweepPendingTmpDirs());
});

test('sweepPendingTmpDirs is a no-op (never throws) when nothing is pending', () => {
  sweepPendingTmpDirs();
  assert.doesNotThrow(() => sweepPendingTmpDirs());
});

test('sweepPendingTmpDirs returns the paths it swept', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-return-');
  const swept = sweepPendingTmpDirs();
  assert.deepEqual(swept, [dir]);
});

test('a second sweep after a fresh mkTmpDir call only removes the NEW directory, not a stale reference to the old one', () => {
  const dirA = mkTmpDir('sfvc-tmpdir-helper-round1-');
  sweepPendingTmpDirs();
  assert.equal(fs.existsSync(dirA), false);

  const dirB = mkTmpDir('sfvc-tmpdir-helper-round2-');
  assert.equal(fs.existsSync(dirB), true);
  sweepPendingTmpDirs();
  assert.equal(fs.existsSync(dirB), false);
});

// ── BL-1601: sweepPendingTmpDirs retries ENOTEMPTY/EBUSY ────────────────
// A detached, unref'd redeploy script can still be writing into a fixture
// root the instant a test returns - the sweep's own directory listing and
// its rmdir can race that write. rmFn is the seam these tests use to
// simulate the race deterministically, never a real concurrent writer.

test('sweepPendingTmpDirs retries a removal that fails ENOTEMPTY twice, then succeeds', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-retry-succeeds-');
  let calls = 0;
  const rmFn = (target, opts) => {
    calls += 1;
    if (calls <= 2) enotempty();
    fs.rmSync(target, opts);
  };

  const swept = sweepPendingTmpDirs(rmFn);

  assert.deepEqual(swept, [dir]);
  assert.equal(calls, 3, 'expected exactly 3 attempts (2 failures then a success)');
  assert.equal(fs.existsSync(dir), false);
});

test('sweepPendingTmpDirs rethrows ENOTEMPTY after its bounded attempts - a root that never empties is a leak, never silenced', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-retry-exhausted-');
  let calls = 0;
  const rmFn = () => {
    calls += 1;
    enotempty();
  };

  assert.throws(() => sweepPendingTmpDirs(rmFn), { code: 'ENOTEMPTY' });
  assert.equal(calls, REMOVE_RETRY_ATTEMPTS, `expected exactly ${REMOVE_RETRY_ATTEMPTS} bounded attempts`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('sweepPendingTmpDirs retries a removal that fails EBUSY twice, then succeeds', () => {
  // ENOTEMPTY and EBUSY are ORed into the same `retryable` check
  // (tmpDir.js) - a suite that only ever throws ENOTEMPTY cannot tell
  // "the disjunction" from "just the first disjunct", so a mutant
  // dropping EBUSY entirely survives undetected without this test (hand-
  // confirmed: reverting the `|| err.code === 'EBUSY'` clause left every
  // other test in this file, and the BL-1601 property test, green).
  const dir = mkTmpDir('sfvc-tmpdir-helper-retry-ebusy-succeeds-');
  let calls = 0;
  const rmFn = (target, opts) => {
    calls += 1;
    if (calls <= 2) ebusy();
    fs.rmSync(target, opts);
  };

  const swept = sweepPendingTmpDirs(rmFn);

  assert.deepEqual(swept, [dir]);
  assert.equal(calls, 3, 'expected exactly 3 attempts (2 EBUSY failures then a success)');
  assert.equal(fs.existsSync(dir), false);
});

test('sweepPendingTmpDirs rethrows EBUSY after its bounded attempts - a root that never empties is a leak, never silenced', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-retry-ebusy-exhausted-');
  let calls = 0;
  const rmFn = () => {
    calls += 1;
    ebusy();
  };

  assert.throws(() => sweepPendingTmpDirs(rmFn), { code: 'EBUSY' });
  assert.equal(calls, REMOVE_RETRY_ATTEMPTS, `expected exactly ${REMOVE_RETRY_ATTEMPTS} bounded attempts`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('sweepPendingTmpDirs succeeds on the first attempt when nothing races it', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-retry-first-try-');
  let calls = 0;
  const rmFn = (target, opts) => {
    calls += 1;
    fs.rmSync(target, opts);
  };

  const swept = sweepPendingTmpDirs(rmFn);

  assert.deepEqual(swept, [dir]);
  assert.equal(calls, 1);
});

test('sweepPendingTmpDirs never retries a non-retryable error (e.g. EACCES) - rethrows immediately', () => {
  const dir = mkTmpDir('sfvc-tmpdir-helper-retry-non-retryable-');
  let calls = 0;
  const rmFn = () => {
    calls += 1;
    const err = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    throw err;
  };

  assert.throws(() => sweepPendingTmpDirs(rmFn), { code: 'EACCES' });
  assert.equal(calls, 1, 'a non-retryable error must not be retried');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── mkSharedTmpDir / sweepSharedTmpDirs (the beforeAll/afterAll sibling) ───
// A dir built once in beforeAll and reused across many tests must survive a
// PER-TEST sweep (sweepPendingTmpDirs) - only its own, separate afterAll
// sweep may remove it. (BL-420 regression: relayOnboardingNegotiationTelegramCli.test.js
// and negotiateOnboardingContractCli.test.js's own PREPARED_ROOT fixture was
// destroyed after their first test when it was registered via mkTmpDir.)

test('a directory created via mkSharedTmpDir survives a per-test sweep', () => {
  const dir = mkSharedTmpDir('sfvc-tmpdir-helper-shared-survives-');
  sweepPendingTmpDirs();

  assert.equal(fs.existsSync(dir), true);

  sweepSharedTmpDirs();
});

test('sweepSharedTmpDirs removes the exact directory mkSharedTmpDir created', () => {
  const dir = mkSharedTmpDir('sfvc-tmpdir-helper-shared-sweep-');
  assert.equal(fs.existsSync(dir), true);

  sweepSharedTmpDirs();

  assert.equal(fs.existsSync(dir), false);
});

test('sweepPendingTmpDirs never removes a directory only mkSharedTmpDir registered', () => {
  const shared = mkSharedTmpDir('sfvc-tmpdir-helper-shared-isolated-');
  const perTest = mkTmpDir('sfvc-tmpdir-helper-pertest-isolated-');

  sweepPendingTmpDirs();

  assert.equal(fs.existsSync(perTest), false, 'the per-test dir must be gone');
  assert.equal(fs.existsSync(shared), true, 'the shared dir must survive a per-test sweep');

  sweepSharedTmpDirs();
  assert.equal(fs.existsSync(shared), false);
});
