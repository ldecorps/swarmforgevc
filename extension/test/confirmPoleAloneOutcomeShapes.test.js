'use strict';

// BL-1721: confirmPoleAlone (recordTestDuration.js) returns {ms} or
// {failed: reason} - never a bare null - so check-suite-file-budget.ts's
// confirmOffendersAlone can report WHICH failure mode actually happened.
// The property test (bl1721FailedPoleConfirmationRetry.property.test.js)
// exhaustively covers the PURE decision logic over synthetic outcome
// shapes; it never calls the real confirmPoleAlone, so none of its own
// distinct failure branches (spawn error, timeout signal, missing report,
// missing entry, generic throw) had any test coverage before this pass -
// a real gap for a function this ticket's own diff added the failure
// shapes to. Real vitest spawns are used here (never a reimplementation
// of the confirmation), but scoped to fast, deterministic outcomes only -
// no timeout/signal case, which would cost 21s per BL-1721's own
// 3x-budget wait and is not reachable without an injected slow fixture.
//
// `file` must be REPO-ROOT relative (recordTestDuration.js's own
// documented convention, e.g. "extension/test/foo.test.js") - this test
// itself was first written passing an extension-relative path by mistake
// and silently got the WRONG branch (no-entry) for what was meant to be
// the success case, which is exactly the kind of confusion a real
// (non-synthetic) exercise catches that a mocked confirmAlone cannot.

const assert = require('node:assert/strict');
const path = require('node:path');
const { confirmPoleAlone } = require('../scripts/recordTestDuration.js');

test('confirmPoleAlone measures a real, existing file and returns {ms}, never a bare number', () => {
  const result = confirmPoleAlone('extension/test/bl1007ContentionBudgetSmoke.test.js');
  assert.equal(typeof result, 'object');
  assert.ok(!('failed' in result), `expected a successful {ms} result, got: ${JSON.stringify(result)}`);
  assert.equal(typeof result.ms, 'number');
  assert.ok(result.ms >= 0, `expected a non-negative duration, got: ${result.ms}`);
});

test('confirmPoleAlone names "no entry" when vitest runs but finds nothing to match the requested file', () => {
  const file = 'extension/test/bl1721-nonexistent-confirm-target.test.js';
  const result = confirmPoleAlone(file);
  assert.ok('failed' in result, `expected a {failed} result, got: ${JSON.stringify(result)}`);
  assert.match(result.failed, /no entry for .* in the confirmation report/);
  assert.ok(result.failed.includes(file), `expected the failure reason to name the requested file, got: ${result.failed}`);
});

test('confirmPoleAlone resolves an absolute file path identically to its repo-root-relative equivalent', () => {
  // BL-1761: the absolute form must be built without a fixed parent-count
  // walk-up (the BL-1066 hazard) - `__dirname` here IS the sandbox's own
  // extension/test/ directory under Stryker, so the target file (this
  // file's own sibling) is reached directly, never via `../..` + a
  // repo-relative segment re-appended (that lands one level too shallow
  // in a Stryker sandbox, where the sandbox itself is the extension root).
  const relFile = 'extension/test/bl1007ContentionBudgetSmoke.test.js';
  const absFile = path.join(__dirname, 'bl1007ContentionBudgetSmoke.test.js');
  const viaRel = confirmPoleAlone(relFile);
  const viaAbs = confirmPoleAlone(absFile);
  assert.ok(!('failed' in viaRel) && !('failed' in viaAbs), `expected both forms to succeed, got: ${JSON.stringify({ viaRel, viaAbs })}`);
});
