'use strict';

// BL-1045 architect pass: property coverage for heldSince.ts, undercovered by
// its own unit tests (a curated list of specific bad strings - blank,
// non-numeric, negative - never a fuzz over arbitrary input). This is
// parsing/formatting stability (this role's property-testing category): the
// derived hold date is rendered on the board, so a parser that could throw or
// return a non-positive/non-integer value on some unanticipated git output
// would either crash the board sync or render an age that lies.
//
// Two properties, one per exported pure function:
//   - parseHeldSinceMs is TOTAL (never throws) over arbitrary strings, and its
//     result is always either undefined or a positive integer multiple of
//     1000 (epoch seconds -> ms).
//   - heldSinceGitArgs accepts every plain filename and refuses every filename
//     carrying a path separator or traversal segment - the BL-1045 guard
//     against a link/query escaping backlog/hold/.

const assert = require('node:assert/strict');
const fc = require('fast-check');

const { heldSinceGitArgs, parseHeldSinceMs } = require('../out/concierge/heldSince');

const RUNS = 300;

// Reach: bare fc.string() would essentially never land on the boundary that
// actually distinguishes this property from a weaker one - the literal digit
// string "0". A `git log` on a file added at the Unix epoch is absurd but not
// impossible, and it is exactly the value a `> 0` check (vs. merely
// `Number.isFinite`) exists to refuse. Numeric-shaped strings, including "0"
// and negative/decimal ones a regex-based parser must also refuse, are drawn
// deliberately alongside arbitrary strings rather than left to chance.
const parseHeldSinceInput = fc.oneof(
  { arbitrary: fc.string(), weight: 4 },
  { arbitrary: fc.constant('0'), weight: 1 },
  { arbitrary: fc.integer({ min: -1_000_000, max: 1_000_000 }).map(String), weight: 3 },
  { arbitrary: fc.float().map(String), weight: 1 }
);

test('property: parseHeldSinceMs never throws, and its result is always undefined or a positive multiple of 1000', () => {
  let reachedZero = false;
  fc.assert(
    fc.property(parseHeldSinceInput, (raw) => {
      if (raw.trim() === '0') reachedZero = true;
      let result;
      assert.doesNotThrow(() => {
        result = parseHeldSinceMs(raw);
      });
      if (result !== undefined) {
        assert.ok(Number.isInteger(result) && result > 0, `${JSON.stringify(raw)} produced non-positive-integer ${result}`);
        assert.equal(result % 1000, 0, `${JSON.stringify(raw)} produced ${result}, not a whole number of seconds`);
      }
      return true;
    }),
    { numRuns: RUNS }
  );
  assert.ok(reachedZero, 'the "0" boundary case was never generated - the > 0 vs isFinite distinction goes untested');
});

test('property: multi-line git output resolves through the first non-blank line only', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2_000_000_000 }), fc.array(fc.string(), { maxLength: 5 }), (seconds, extraLines) => {
      const raw = [String(seconds), ...extraLines].join('\n');
      assert.equal(parseHeldSinceMs(raw), seconds * 1000);
      return true;
    }),
    { numRuns: RUNS }
  );
});

const plainFilename = fc
  .string({ minLength: 1, maxLength: 30 })
  .map((s) => s.replace(/[/\\]/g, '_').replace(/\.\./g, '_').trim())
  .filter((s) => s.length > 0);

const escapingFilename = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string().map((s) => `../${s}`),
  fc.string().map((s) => `a/${s}`),
  fc.string().map((s) => `a\\${s}`),
  fc.string().map((s) => `${s}..${s}`)
);

test('property: every plain filename is accepted and yields a query scoped under backlog/hold/', () => {
  fc.assert(
    fc.property(plainFilename, (filename) => {
      const args = heldSinceGitArgs(filename);
      assert.equal(args[args.length - 1], `backlog/hold/${filename}`);
      assert.deepEqual(args.slice(0, -1), ['log', '--diff-filter=A', '--format=%at', '-1', '--']);
      return true;
    }),
    { numRuns: RUNS }
  );
});

test('property: any filename carrying a separator or traversal segment, or that is blank, is refused', () => {
  fc.assert(
    fc.property(escapingFilename, (filename) => {
      assert.throws(() => heldSinceGitArgs(filename), /filename/);
      return true;
    }),
    { numRuns: RUNS }
  );
});
