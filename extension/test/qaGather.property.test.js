const assert = require('node:assert/strict');
const fc = require('fast-check');
const { CHECKLIST, runChecklist, buildRegisterJoin, tailExcerpt, EXCERPT_MAX_CHARS, composeQaGatherReport } = require('../out/quality/qaGather');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

// BL-1554 invariants (coder-authored first, per BL-654):
//
//   invariant 1 - the report never encodes a verdict: no row (and no
//     top-level report field, proven separately by the pure unit tests -
//     this property targets the GENERATIVE half, the rows) carries a
//     verdict/pass/bounce/approve-shaped field, for ANY generated mix of
//     exits, blocked reasons and outputs.
//
//   invariant 3 - checks start in the fixed order, each only after the
//     previous ended; a check that cannot start (either because its own
//     prerequisite is missing - build() blocks it before ever calling
//     runFn - or because the runner itself could not start it) is
//     reported blocked with its reason, and no check is ever omitted:
//     for ANY generated mix of which checks are blocked and how, the
//     report always has exactly CHECKLIST.length rows in exactly
//     CHECKLIST's own id order.
//
// Invariant 2 ("every check runs through the one injected runner seam,
// nothing reimplemented") is a STRUCTURAL/process claim about this
// module's own source shape (there is exactly one call site of runFn,
// and the register join parses the register CLI's own JSON rather than
// re-deriving ownership) - not a generative data claim a random input
// space exercises differently each run. Recorded here rather than left
// silently unencoded: verified by inspection (one call to runFn per
// checklist iteration in runChecklist's own for-loop; buildRegisterJoin
// takes a RegisterReport already parsed from the register check's own
// stdout, never re-implementing real-ticket-state/owned itself) and by
// the register-join unit tests in qaGather.test.js, which exercise the
// parse-then-join path directly against real register CLI JSON shapes.

const CHECK_IDS = CHECKLIST.map((c) => c.id);

// Each check independently: either a runner-cannot-start answer (random
// reason), or a started answer with a random exit code and output text
// that deliberately peppers the very words invariant 1 forbids as a
// VALUE, to prove they survive harmlessly inside freeform excerpt text
// without leaking into any structural field.
const outputArb = fc.oneof(
  fc.constantFrom('', 'ok', '2412 passed', '3 failed', 'PASS', 'BOUNCE', 'approve this'),
  fc.string({ maxLength: 40 }),
);

const perCheckAnswerArb = fc.oneof(
  { weight: 1, arbitrary: fc.record({ started: fc.constant(false), reason: fc.string({ minLength: 1, maxLength: 30 }) }) },
  {
    weight: 3,
    arbitrary: fc.record({
      started: fc.constant(true),
      exit: fc.integer({ min: 0, max: 255 }),
      stdout: outputArb,
      stderr: outputArb,
    }),
  },
);

// Whether wiring/acceptance's own PREREQUISITE is present (task/acceptance
// feature) - when absent, build() itself blocks the check before runFn is
// ever consulted, the OTHER way a check can fail to start.
const ctxArb = fc.record({
  hasTask: fc.boolean(),
  hasAcceptance: fc.boolean(),
});

function buildScript() {
  return fc.dictionary(fc.constantFrom(...CHECK_IDS), perCheckAnswerArb);
}

test('property: every generated run has exactly one row per checklist id, in the checklist\'s own order, and no row is verdict-shaped', () => {
  fc.assert(
    fc.property(buildScript(), ctxArb, (script, ctxFlags) => {
      const ctx = {
        root: '/r',
        ticketId: 'BL-1',
        commit: 'abc1234567',
        task: ctxFlags.hasTask ? 't' : undefined,
        acceptanceFeature: ctxFlags.hasAcceptance ? 'f.feature' : undefined,
      };

      // Ground truth, computed independently of the run below: which
      // checks are blocked by their OWN missing prerequisite (build()
      // itself refuses before runFn is ever consulted for them), and the
      // exact built (command, args, cwd) every OTHER check must produce,
      // in the checklist's own order - two checks (stragglers_before/
      // _after) build an IDENTICAL command, so identity here is POSITION
      // in this expected sequence, never a content guess made at call
      // time (which could not tell the two apart).
      const builtById = new Map(CHECKLIST.map((c) => [c.id, c.build(ctx)]));
      const prerequisiteBlockedIds = new Set([...builtById.entries()].filter(([, b]) => 'blockedReason' in b).map(([id]) => id));
      const expectedCalledIds = CHECK_IDS.filter((id) => !prerequisiteBlockedIds.has(id));
      const expectedCallShapes = expectedCalledIds.map((id) => {
        const b = builtById.get(id);
        return { command: b.command, args: b.args, cwd: b.cwd };
      });

      const calls = [];
      const runFn = (command, args, cwd) => {
        // The check this call belongs to is exactly expectedCalledIds at
        // this position - runChecklist visits checks in fixed order and
        // only ever calls runFn for a non-prerequisite-blocked one, which
        // the shape assertion below verifies independently.
        const id = expectedCalledIds[calls.length];
        calls.push({ command, args, cwd, seq: calls.length });
        const answer = script[id];
        if (!answer) {
          return { started: true, exit: 0, stdout: '', stderr: '' };
        }
        if (!answer.started) {
          return { started: false, exit: null, stdout: '', stderr: '', reason: answer.reason };
        }
        return { started: true, exit: answer.exit, stdout: answer.stdout, stderr: answer.stderr };
      };

      const rows = runChecklist(CHECKLIST, ctx, runFn);

      // invariant 3: never omitted, always the fixed order.
      assert.equal(rows.length, CHECKLIST.length);
      assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);

      // invariant 3: a blocked check (either shape) is reported blocked
      // with a reason.
      for (const row of rows) {
        if (row.status === 'blocked') {
          assert.ok(typeof row.reason === 'string' && row.reason.length > 0, `blocked row ${row.id} has no reason`);
        }
      }

      // invariant 3 (never omitted, seam is the only path in): exactly
      // the non-prerequisite-blocked checks reach runFn, each exactly
      // once, each with exactly its own built command, in the
      // checklist's own fixed order.
      assert.equal(calls.length, expectedCallShapes.length);
      assert.deepEqual(
        calls.map((c) => ({ command: c.command, args: c.args, cwd: c.cwd })),
        expectedCallShapes,
      );
      assert.deepEqual(
        calls.map((c) => c.seq),
        calls.map((c) => c.seq).slice().sort((a, b) => a - b),
      );

      // invariant 1: no row is verdict-shaped, however the generator
      // peppers "pass"/"bounce"/"approve" into freeform output text.
      for (const row of rows) {
        assert.ok(!('verdict' in row), `row ${row.id} carries a verdict field`);
        assert.ok(row.status === 'ran' || row.status === 'blocked', `row ${row.id} has a non-mechanical status: ${row.status}`);
      }
    }),
    { numRuns: 200 },
  );
}, propertyLaneTimeoutMs(20000));

// BL-1769 invariant (coder-authored first, per BL-654): a unit or
// properties row that ran with a non-zero exit always contributes at
// least one register_join entry - each failing file it names, or one
// `unidentified` entry for that check - whatever the length of its
// output. Generates a FAIL line at a random offset inside random-length
// filler on BOTH sides (up to 2x EXCERPT_MAX_CHARS, so the line often
// falls outside the display excerpt's own tail window) and asserts the
// entry the join actually produces against exit and hasFailLine alone -
// never against row.excerpt, the exact bounded field the pre-fix code
// wrongly parsed (BL-1726, BL-1766).
const FAIL_FILE_NAMES = ['test/foo.test.js', 'test/bar.property.test.js', 'test/nested/baz.test.tsx', 'test/qux.property.test.ts'];

// Filler that can never itself accidentally form a FAIL-line match.
function filler(length) {
  return '.'.repeat(length);
}

test('property (BL-1769 invariant): a red unit/properties row always contributes at least one register_join entry, whatever the length or offset of its output', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('unit', 'properties'),
      fc.integer({ min: 0, max: 255 }),
      fc.boolean(),
      fc.constantFrom(...FAIL_FILE_NAMES),
      fc.nat({ max: EXCERPT_MAX_CHARS * 2 }),
      fc.nat({ max: EXCERPT_MAX_CHARS * 2 }),
      (checkId, exit, hasFailLine, fileName, prefixPad, suffixPad) => {
        const failLine = ` FAIL  ${fileName} > x\n`;
        const wholeOutput = hasFailLine
          ? filler(prefixPad) + failLine + filler(suffixPad)
          : filler(prefixPad + suffixPad);
        const row = { id: checkId, status: 'ran', exit, excerpt: tailExcerpt(wholeOutput) };
        const join = buildRegisterJoin([row], undefined, undefined, new Map([[checkId, wholeOutput]]));

        // The invariant's own claim, stated directly: non-zero exit never
        // comes back with an empty join.
        if (exit !== 0) {
          assert.ok(join.length >= 1, `non-zero exit (${exit}) produced an empty join for output length ${wholeOutput.length}`);
        }

        // The precise shape, branch by branch.
        if (hasFailLine) {
          assert.deepEqual(join, [{ file: `extension/${fileName}`, join: 'absent' }]);
        } else if (exit !== 0) {
          assert.deepEqual(join, [{ file: checkId, join: 'unidentified' }]);
        } else {
          assert.deepEqual(join, []);
        }
      }
    ),
    { numRuns: 200 },
  );
}, propertyLaneTimeoutMs(20000));

// BL-2024's two declared invariants (coder-authored first, per BL-654):
//
//   invariant 1 - a parcel whose own diff touches any path outside
//     backlog/, or whose diff cannot be computed (a failed merge-base, a
//     failed diff, or an empty diff), runs both the unit and properties
//     lanes - the skip fails closed on any doubt, never defaults to
//     skipping.
//
//   invariant 2 - a skipped lane is reported with status 'skipped' and a
//     non-empty reason, never 'ran' (so never mistaken for a pass or a
//     failure) - and the underlying npm command never actually started.
//
// GENERATOR REACH (BL-1062/BL-1584): the interesting population here is a
// conjunction (merge-base resolves AND diff resolves AND every path is
// backlog/) that independent uniform draws would reach only rarely - a
// sampled-high reach floor over such a conjunction is a real, not a
// cosmetic, risk (BL-2087's own incident class). Each of the five
// decision branches below is therefore its own CELL, run with a
// guaranteed share of the budget (runsPerCell) - reached by construction,
// never hoped for - with randomness kept only to the parts that do not
// decide which branch is under test (how many backlog/ paths, their
// names, which specific failure flavor within a cell).
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const BACKLOG_PATH_ARB = fc.string({ minLength: 1, maxLength: 12 }).map((s) => `backlog/evidence/${encodeURIComponent(s) || 'x'}.md`);
const OTHER_PATH_ARB = fc.constantFrom(
  'extension/src/tools/bl9001.ts',
  'specs/pipeline/steps/bl9001Steps.js',
  'swarmforge/scripts/bl9001.bb',
  'docs/how-to/BL-9001-fixture.md'
);
const BACKLOG_PATHS_ARB = fc.array(BACKLOG_PATH_ARB, { minLength: 1, maxLength: 5 });

const RESOLVED = { mergeBaseStarted: true, mergeBaseExit: 0, diffStarted: true, diffExit: 0 };

function backlogOnlySkipRunFn(paths, resolution, npmCalls) {
  return (command, args) => {
    if (command === 'git' && args[0] === 'merge-base') {
      if (!resolution.mergeBaseStarted) {
        return { started: false, exit: null, stdout: '', stderr: '', reason: 'merge-base could not start' };
      }
      return { started: true, exit: resolution.mergeBaseExit, stdout: resolution.mergeBaseExit === 0 ? 'base-sha-0000000001\n' : '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'diff') {
      if (!resolution.diffStarted) {
        return { started: false, exit: null, stdout: '', stderr: '', reason: 'diff could not start' };
      }
      return { started: true, exit: resolution.diffExit, stdout: resolution.diffExit === 0 ? paths.join('\n') : '', stderr: '' };
    }
    if (command === 'npm' && (args.includes('test') || args.includes('test:properties'))) {
      npmCalls.push(args.join(' '));
      return { started: true, exit: 0, stdout: '', stderr: '' };
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };
}

function assertSkipped(unitRow, propsRow, npmCalls, label) {
  assert.equal(unitRow.status, 'skipped', `${label}: expected unit skipped`);
  assert.equal(propsRow.status, 'skipped', `${label}: expected properties skipped`);
  assert.ok(typeof unitRow.reason === 'string' && unitRow.reason.length > 0, `${label}: a skipped row must carry a non-empty reason`);
  assert.ok(typeof propsRow.reason === 'string' && propsRow.reason.length > 0, `${label}: a skipped row must carry a non-empty reason`);
  assert.equal(npmCalls.length, 0, `${label}: a skipped lane must never actually start its command`);
}

function assertRan(unitRow, propsRow, npmCalls, label) {
  assert.equal(unitRow.status, 'ran', `${label}: expected unit to run (fail closed)`);
  assert.equal(propsRow.status, 'ran', `${label}: expected properties to run (fail closed)`);
  assert.equal(npmCalls.length, 2, `${label}: both lanes must have actually started when not skipping`);
}

const CELLS = ['skip', 'mergeBaseFailed', 'diffFailed', 'emptyDiff', 'mixedPaths'];
const CELL_RUNS = runsPerCell(200, CELLS.length);

test('property (BL-2024 invariants 1/2): a backlog-only diff skips both lanes with a reason; any doubt runs both, never started', () => {
  const reach = { skip: 0, mergeBaseFailed: 0, diffFailed: 0, emptyDiff: 0, mixedPaths: 0 };

  function run(cell, arb, buildCase) {
    fc.assert(
      fc.property(arb, (drawn) => {
        reach[cell] += 1;
        const { paths, resolution, expectSkip } = buildCase(drawn);
        const npmCalls = [];
        const runFn = backlogOnlySkipRunFn(paths, resolution, npmCalls);
        const report = composeQaGatherReport('/r', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);
        const unitRow = report.checks.find((c) => c.id === 'unit');
        const propsRow = report.checks.find((c) => c.id === 'properties');
        if (expectSkip) {
          assertSkipped(unitRow, propsRow, npmCalls, cell);
        } else {
          assertRan(unitRow, propsRow, npmCalls, cell);
        }
        // invariant 2, restated: a row is never anything but one of these three.
        assert.ok(['ran', 'blocked', 'skipped'].includes(unitRow.status));
        assert.ok(['ran', 'blocked', 'skipped'].includes(propsRow.status));
      }),
      { numRuns: CELL_RUNS }
    );
  }

  // Cell 'skip': the rare conjunction, constructed directly - resolved AND
  // every path backlog/.
  run('skip', BACKLOG_PATHS_ARB, (paths) => ({ paths, resolution: RESOLVED, expectSkip: true }));

  // Cell 'mergeBaseFailed': resolved otherwise, but the merge-base call
  // itself fails (either never started, or a non-zero exit) - paths are
  // irrelevant to the outcome, so still drawn randomly (never fixed).
  run(
    'mergeBaseFailed',
    fc.tuple(BACKLOG_PATHS_ARB, fc.boolean(), fc.integer({ min: 1, max: 2 })),
    ([paths, neverStarted, exit]) => ({
      paths,
      resolution: { ...RESOLVED, mergeBaseStarted: !neverStarted, mergeBaseExit: neverStarted ? 0 : exit },
      expectSkip: false,
    })
  );

  // Cell 'diffFailed': merge-base resolves, but the diff call fails.
  run(
    'diffFailed',
    fc.tuple(BACKLOG_PATHS_ARB, fc.boolean(), fc.integer({ min: 1, max: 2 })),
    ([paths, neverStarted, exit]) => ({
      paths,
      resolution: { ...RESOLVED, diffStarted: !neverStarted, diffExit: neverStarted ? 0 : exit },
      expectSkip: false,
    })
  );

  // Cell 'emptyDiff': both resolve, but the diff itself is empty (no
  // changed paths at all).
  run('emptyDiff', fc.constant(undefined), () => ({ paths: [], resolution: RESOLVED, expectSkip: false }));

  // Cell 'mixedPaths': both resolve, the diff is non-empty, but at least
  // one path is NOT under backlog/ - constructed directly (one backlog/
  // path and one other, in a random order), never hoped for from an
  // independent per-path coin flip.
  run('mixedPaths', fc.tuple(BACKLOG_PATH_ARB, OTHER_PATH_ARB, fc.boolean()), ([backlogPath, otherPath, backlogFirst]) => ({
    paths: backlogFirst ? [backlogPath, otherPath] : [otherPath, backlogPath],
    resolution: RESOLVED,
    expectSkip: false,
  }));

  assertReachFloor(reach, CELLS, 1, 'backlog-only-skip decision branch');
}, propertyLaneTimeoutMs(20000));
