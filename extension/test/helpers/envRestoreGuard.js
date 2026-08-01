'use strict';

// BL-720: process.env persists across every test file sharing a worker
// (vitest.config.mjs's poolOptions.forks.isolate: false, BL-445). A test
// that leaves a key different from what it found corrupts every later
// file's environment silently - the suite's verdict then depends on fork
// and file scheduling instead of the code under test. This module is the
// pure snapshot/diff/format logic; envRestoreGuardSetup.js wires it into a
// real per-test beforeEach/afterEach via vitest.config.mjs's setupFiles,
// same split as rawMkdtempGuard.js (BL-420).

// Impure: a shallow copy of process.env at this instant. Independent of
// later mutation since it is a plain object, not a live view.
function snapshotEnv() {
  return { ...process.env };
}

// Pure: given two flat string-keyed snapshots of process.env (taken before
// and after one test), the list of keys left different - added, removed, or
// changed value - sorted by key for a stable, deterministic message.
function diffEnvSnapshots(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const leaks = [];
  for (const key of keys) {
    if (before[key] !== after[key]) {
      leaks.push({ key, before: before[key], after: after[key] });
    }
  }
  return leaks.sort((a, b) => a.key.localeCompare(b.key));
}

// Pure: renders a diffEnvSnapshots() result into the loud, actionable
// failure message BL-720 scenario env-restore-04 requires - names the file,
// the test, and every leaked key, never a generic "env changed".
function formatEnvLeakMessage(testFile, testName, leaks) {
  const lines = leaks.map((leak) => {
    const from = leak.before === undefined ? '(unset)' : JSON.stringify(leak.before);
    const to = leak.after === undefined ? '(unset)' : JSON.stringify(leak.after);
    return `  ${leak.key}: ${from} -> ${to}`;
  });
  return [
    `[env-restore-guard] ${testFile} ("${testName}") left process.env different from what it found:`,
    ...lines,
    'A test that mutates a process.env key must restore it exactly: capture the prior value before mutating, then in finally either restore that value or delete the key if it was absent (see cursorBridgeAgentSession.test.js for the established idiom).',
  ].join('\n');
}

module.exports = { snapshotEnv, diffEnvSnapshots, formatEnvLeakMessage };
