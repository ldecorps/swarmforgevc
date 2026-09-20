'use strict';

// BL-1630: step handlers for "No step handler does work at module load".
//
// Drives the REAL census helper (extension/test/helpers/stepHandlerRequireCensus.js)
// against the REAL specs/pipeline/steps tree - never a reimplementation of
// the require-timing or the fixture instrumentation. Scenario 01 requires
// each of the twelve NAMED handlers in its own fresh child process
// (censusOneHandler); scenario 02 drives the same aggregate census the
// unit-lane guard (extension/test/stepHandlerModuleLoadBudget.test.js)
// uses; scenario 03 reads this parcel's own before/after evidence file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trackedTmpRoot } = require('./lib/fixtureReaper');
const {
  censusOneHandler,
  censusAllHandlers,
  censusIndexJsWallMs,
  checkHandlerBudgets,
} = require('../../../extension/test/helpers/stepHandlerRequireCensus');

const FEATURE = 'BL-1630 No step handler does work at module load';

const PER_HANDLER_BUDGET_MS = 200;
const INDEX_JS_WALL_BUDGET_MS = 5000;

// The twelve the ticket's own feature Examples table names (BL-1445 census
// pin - named, not derived). This scenario's own contract is exactly these
// twelve; the two more this parcel's own guard found (bl1536, bl1565) are
// documented in the evidence file scenario 03 reads, not re-asserted here.
const TWELVE_NAMED_HANDLERS = [
  'bl1299ReverseHopMasterResidentSteps.js',
  'bl1327DescentLadderProposalSteps.js',
  'bl1320SeatOperatorStepSteps.js',
  'bl1306HandoffAuditRerouteSteps.js',
  'bl1323MainSyncDeadlockOverlapHintsStampSteps.js',
  'bl1332SharedPathLineLeakSteps.js',
  'bl1153StickyWebFontSizeChoiceSteps.js',
  'bl1335ExhaustionOpensFailoverRecordSteps.js',
  'bl1339LandApprovalSharedRootSteps.js',
  'bl1375ApprovedSiblingsCanLandSteps.js',
  'bl1352EscalationTransportFaultSteps.js',
  'bl1343ReplayDropsTheTicketsOwnPathSteps.js',
];

// Mirrors the guard's own one documented allowlist entry (out-of-scope
// jsdom cascade, see the guard file's own comment and
// backlog/evidence/BL-1630-coder-out-of-scope-findings-20260920.md) -
// scenario 02 exercises the SAME real tree the guard runs against, so it
// must apply the SAME allowlist to make the same true claim, not a
// stricter one.
const ALLOWLIST = new Map([
  ['bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js', 'pre-existing eager jsdom require, out of BL-1630 scope'],
  ['bl1050CursorRunFailureLogSteps.js', 'genuinely heavy production-code require (BL-968 compliant), out of BL-1630 scope'],
]);

const EVIDENCE_PATH = path.join(__dirname, '..', '..', '..', 'backlog', 'evidence', 'BL-1630-coder-census-20260920.md');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^(\S+) is required in a fresh child process and its incremental cost is measured$/, (ctx, handler) => {
    assert.ok(TWELVE_NAMED_HANDLERS.includes(handler), `unknown <handler> example value: ${handler}`);
    ctx.bl1630Row = censusOneHandler(handler);
  });

  scoped(/^the cost is under the per-handler budget$/, (ctx) => {
    assert.ok(ctx.bl1630Row, 'no handler was censused yet');
    assert.ok(
      ctx.bl1630Row.ms < PER_HANDLER_BUDGET_MS,
      `${ctx.bl1630Row.file} cost ${ctx.bl1630Row.ms.toFixed(1)}ms, expected under ${PER_HANDLER_BUDGET_MS}ms`
    );
  });

  scoped(/^requiring it lists no directory, spawns no process and registers no test runner$/, (ctx) => {
    const row = ctx.bl1630Row;
    assert.equal(row.error, null, `expected no require error, got: ${row.error}`);
    assert.equal(row.listedDir, false, `${row.file}: expected no directory listing at module load`);
    assert.equal(row.spawnedProcess, false, `${row.file}: expected no process spawn at module load`);
    assert.equal(row.registeredTestRunner, false, `${row.file}: expected no test runner registration at module load`);
  });

  scoped(/^the module-load budget guard runs the require census over every step handler$/, (ctx) => {
    const { rows } = censusAllHandlers();
    ctx.bl1630Rows = rows;
    ctx.bl1630Violations = checkHandlerBudgets(rows, { budgetMs: PER_HANDLER_BUDGET_MS, allowlist: ALLOWLIST });
    ctx.bl1630WallMs = censusIndexJsWallMs();
  });

  scoped(
    /^it reports every handler under the per-handler budget and the index load under 5 seconds$/,
    (ctx) => {
      assert.deepEqual(
        ctx.bl1630Violations,
        [],
        `module-load budget violation(s): ${JSON.stringify(ctx.bl1630Violations)}`
      );
      assert.ok(
        ctx.bl1630WallMs < INDEX_JS_WALL_BUDGET_MS,
        `index.js load took ${ctx.bl1630WallMs}ms, expected under ${INDEX_JS_WALL_BUDGET_MS}ms`
      );
    }
  );

  scoped(
    /^the same guard over a fixture handler that lists the temp dir at load names that handler$/,
    () => {
      const fixtureDir = trackedTmpRoot('aps-bl1630-fixture-');
      try {
        fs.writeFileSync(
          path.join(fixtureDir, 'zzzFixtureOffenderSteps.js'),
          "'use strict';\nconst fs = require('node:fs');\nconst os = require('node:os');\nfs.readdirSync(os.tmpdir());\nfunction registerSteps() {}\nmodule.exports = { registerSteps };\n"
        );
        const { rows } = censusAllHandlers(fixtureDir);
        const violations = checkHandlerBudgets(rows, { budgetMs: PER_HANDLER_BUDGET_MS });
        assert.equal(violations.length, 1, `expected exactly one violation, got: ${JSON.stringify(violations)}`);
        assert.equal(violations[0].file, 'zzzFixtureOffenderSteps.js');
        assert.match(violations[0].reason, /lists a directory at module load/);
      } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
    }
  );

  scoped(/^the parcel's evidence is read$/, (ctx) => {
    ctx.bl1630Evidence = fs.readFileSync(EVIDENCE_PATH, 'utf8');
  });

  scoped(
    /^it carries the census script's output for the received commit and for the parcel commit$/,
    (ctx) => {
      assert.match(ctx.bl1630Evidence, /## Before \(received commit/);
      assert.match(ctx.bl1630Evidence, /## After \(parcel commit/);
      assert.match(ctx.bl1630Evidence, /files \d+ total_ms \d+/g);
    }
  );

  scoped(/^both name the twelve handlers and the two totals$/, (ctx) => {
    const evidence = ctx.bl1630Evidence;
    for (const handler of TWELVE_NAMED_HANDLERS) {
      assert.ok(evidence.includes(handler), `evidence does not name ${handler}`);
    }
    const totalMsMatches = evidence.match(/total_ms \d+/g) || [];
    assert.ok(totalMsMatches.length >= 2, `expected at least two total_ms readings, found ${totalMsMatches.length}`);
    const wallMatches = evidence.match(/\d+(?:-\d+)?ms wall/g) || [];
    assert.ok(wallMatches.length >= 2, `expected at least two index.js wall readings, found ${wallMatches.length}`);
  });
}

module.exports = { registerSteps };
