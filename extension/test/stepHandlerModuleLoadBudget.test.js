'use strict';

// BL-1630: the unit-lane guard - a step handler does no work at module
// load (BL-1371's registration is discovery: index.js requires every
// *Steps.js at load, so a temp-dir listing, a process spawn or a
// node:test registration there is paid by every mere require() of the
// registry, not just a real acceptance run - bl968's structural probes
// and the BL-761 registration gate both pay it for nothing). This test
// requires every real *Steps.js file in a fresh child, fails naming any
// handler whose incremental require exceeds the per-handler budget or
// that lists a directory / spawns a process / registers a test runner,
// and fails if the whole index.js load exceeds 5 seconds.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { checkHandlerBudgets, censusAllHandlers, censusIndexJsWallMs } = require('./helpers/stepHandlerRequireCensus');

const PER_HANDLER_BUDGET_MS = 200;
const INDEX_JS_WALL_BUDGET_MS = 5000;

// BL-1630 out-of-scope allowlist (ticket's own "How": a handler that
// legitimately needs more names why here, with a ticket). NOT one of this
// ticket's twelve named handlers - discovered only because fixing
// bl1153/bl1412 (this parcel) unmasked it: multiple OTHER handlers
// (bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js itself, and - once bl592
// is fixed - bl609ResidentSpyFontSizeControlSteps.js,
// bl674EpicDrilldownUiSteps.js, bl686EpicDrilldownSlugMatchSteps.js,
// bl687EpicReorderIncludesActiveChildrenSteps.js,
// bl775BubbleLiveScreenShellSteps.js and bl929LiveScreenPackLayoutSteps.js)
// ALSO require jsdom eagerly at module scope; a sequential require census
// only ever charges the ALPHABETICALLY FIRST one still doing this (require
// caches jsdom for everyone after it), so fixing bl592 alone would simply
// shift this same budget failure to bl609 next, not clear it. A full sweep
// of all eight is a separate, larger ticket than this one's twelve moves -
// flagged to the specifier (unowned-defect note, 2026-09-20) rather than
// grown into this parcel's scope. Remove an entry only when its named
// handler's own eager require is fixed AND the next one in this same
// require-cache chain is fixed in the SAME sweep (fixing one at a time
// forever re-arms this guard on the next name).
// bl1050CursorRunFailureLogSteps.js is a DIFFERENT shape from the jsdom
// cascade above: its own header comment states "Invariant (BL-968): module
// load is requires and pure constants only" - it does no filesystem
// listing, no process spawn, no test-runner registration; its cost is a
// genuinely heavy, non-optional require (extension/out/bridge/
// cursorBridgeAgentSession.js's own dependency chain) that this ticket's
// twelve moves have no bearing on. Measured 137-320ms depending on host
// load (fork contention in the full unit-lane run reliably pushes it past
// 200ms - not a cascade like bl592's, just natural timing variance close
// to the budget), so it is allowlisted rather than left to flake this
// guard red under load.
const ALLOWLIST = new Map([
  [
    'bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js',
    'pre-existing eager jsdom require at module load, out of BL-1630 scope - see the comment above',
  ],
  [
    'bl1050CursorRunFailureLogSteps.js',
    'genuinely heavy production-code require (BL-968 compliant), out of BL-1630 scope - see the comment above',
  ],
]);

test('the module-load budget guard runs the require census over every real step handler and reports every handler under budget (or documented) and the index load under 5 seconds', () => {
  const { rows } = censusAllHandlers();
  const violations = checkHandlerBudgets(rows, { budgetMs: PER_HANDLER_BUDGET_MS, allowlist: ALLOWLIST });
  assert.deepEqual(
    violations,
    [],
    `module-load budget violation(s):\n${violations.map((v) => `  ${v.file}: ${v.reason}`).join('\n')}`
  );

  const wallMs = censusIndexJsWallMs();
  assert.ok(
    wallMs < INDEX_JS_WALL_BUDGET_MS,
    `require('specs/pipeline/steps/index.js') took ${wallMs}ms, expected under ${INDEX_JS_WALL_BUDGET_MS}ms`
  );
});

test('every allowlist entry still exists - a renamed or deleted handler must have its entry removed', () => {
  // BL-1630: NOT a "still exceeds budget" check - bl1050's own cost (a
  // genuinely heavy require, not a fixable anti-pattern) sits close enough
  // to the budget that fork contention alone flips it either side of 200ms
  // run to run (see the guard's ALLOWLIST comment); asserting "must
  // currently measure over budget" here would make THIS check flaky for
  // exactly the entry it exists to track. Existence is the only claim that
  // stays true regardless of host load.
  const { rows } = censusAllHandlers();
  const byFile = new Map(rows.map((r) => [r.file, r]));
  for (const file of ALLOWLIST.keys()) {
    const row = byFile.get(file);
    assert.ok(row, `allowlisted file ${file} no longer exists in the step handler tree - remove its entry`);
  }
});

test('checkHandlerBudgets non-vacuity: a fixture handler that lists a directory at module load is named, never silently passed', () => {
  const fixtureDir = mkTmpDir('bl1630-module-load-guard-fixture-');
  fs.writeFileSync(
    path.join(fixtureDir, 'zzzFixtureOffenderSteps.js'),
    "'use strict';\nconst fs = require('node:fs');\nconst os = require('node:os');\nfs.readdirSync(os.tmpdir());\nfunction registerSteps() {}\nmodule.exports = { registerSteps };\n"
  );

  const { rows } = censusAllHandlers(fixtureDir);
  assert.equal(rows.length, 1, `expected exactly one fixture handler, got: ${JSON.stringify(rows)}`);
  assert.equal(rows[0].listedDir, true, 'expected the fixture handler to be caught listing a directory at load');

  const violations = checkHandlerBudgets(rows, { budgetMs: PER_HANDLER_BUDGET_MS });
  assert.equal(violations.length, 1, `expected exactly one violation, got: ${JSON.stringify(violations)}`);
  assert.equal(violations[0].file, 'zzzFixtureOffenderSteps.js');
  assert.match(violations[0].reason, /lists a directory at module load/);
});

test('checkHandlerBudgets non-vacuity: the allowlist never exempts a behavioral violation, only the ms budget', () => {
  const rows = [
    { file: 'fakeSteps.js', ms: 1, listedDir: true, spawnedProcess: false, registeredTestRunner: false, error: null },
  ];
  const violations = checkHandlerBudgets(rows, {
    budgetMs: PER_HANDLER_BUDGET_MS,
    allowlist: new Map([['fakeSteps.js', 'not a real exemption']]),
  });
  assert.equal(violations.length, 1, 'expected the allowlist to leave a behavioral violation in place');
  assert.match(violations[0].reason, /lists a directory at module load/);
});
