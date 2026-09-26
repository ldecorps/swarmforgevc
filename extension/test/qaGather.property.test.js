const assert = require('node:assert/strict');
const fc = require('fast-check');
const { CHECKLIST, runChecklist, buildRegisterJoin, tailExcerpt, EXCERPT_MAX_CHARS } = require('../out/quality/qaGather');
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
