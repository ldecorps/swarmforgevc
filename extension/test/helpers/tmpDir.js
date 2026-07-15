'use strict';

// BL-420: the SHARED temp-dir helper every extension test allocates its
// os.tmpdir() mkdtemp root through, so cleanup happens exactly once, in one
// place, on both the pass and throw paths - not ~147 hand-rolled variants.
// mkTmpDir only creates and records; sweepPendingTmpDirs (called from a
// Vitest afterEach registered by tmpDirSetup.js, wired into
// vitest.config.mjs's test.setupFiles) does the actual removal. Split this
// way so a unit test can drive the sweep directly without needing a real
// Vitest afterEach cycle to observe it.
const fs = require('fs');
const os = require('os');
const path = require('path');

let pending = [];
let pendingShared = [];

// Creates a real mkdtemp dir under os.tmpdir() with the given prefix
// (preserves every existing naming convention - sfvc-/relay-/negotiate-/etc -
// callers pass their own prefix unchanged) and records it for the next
// PER-TEST sweep (tmpDirSetup.js's afterEach). Never removes anything
// itself - a test that wants EARLY removal (before its own teardown) still
// calls fs.rmSync directly; sweepPendingTmpDirs tolerates an already-gone
// path either way.
function mkTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  pending.push(dir);
  return dir;
}

// The beforeAll sibling of mkTmpDir: a dir built ONCE and reused (read-only
// or copy-from) across every test in a file - registered for a per-FILE
// afterAll sweep instead, so it survives until every test in the file has
// run rather than being destroyed after the first one. Use this, never
// mkTmpDir, for a dir created inside beforeAll and referenced from multiple
// tests (the PREPARED_ROOT convention negotiateOnboardingContractCli.test.js
// and relayOnboardingNegotiationTelegramCli.test.js both use).
function mkSharedTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  pendingShared.push(dir);
  return dir;
}

// Removes every path handed out via mkTmpDir since the last sweep and
// returns them (mainly for the helper's own tests to assert against).
// force:true tolerates a path already removed (by the test itself, or a
// prior sweep) rather than throwing mid-teardown.
function sweepPendingTmpDirs() {
  const dirs = pending;
  pending = [];
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return dirs;
}

// The afterAll sweep for mkSharedTmpDir's own registry - same tolerant
// removal, separate list, so a per-test afterEach can never race it away
// early.
function sweepSharedTmpDirs() {
  const dirs = pendingShared;
  pendingShared = [];
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return dirs;
}

module.exports = { mkTmpDir, mkSharedTmpDir, sweepPendingTmpDirs, sweepSharedTmpDirs };
