const assert = require('node:assert/strict');
const fc = require('fast-check');
const { parseTestTimeouts } = require('../../specs/pipeline/steps/lib/testTimeoutParser');

// BL-914 (architect Property Testing pass): testTimeoutParser.js is a pure,
// touched module this ticket introduced with no dedicated test of its own
// (only indirect exercise via bl914PerTestTimeoutSteps.js against the 3
// real files it targets today) - a textbook parsing/formatting-stability
// candidate the architect role prompt names explicitly. Runs ONLY via
// `npm run test:properties`; excluded from unit/coverage/mutation.
//
// Property: formatting a list of {name, timeoutMs} specs into real
// `test(name, fn[, timeoutMs])` source (escaping each name exactly the way
// the parser's own skipStringLiteral + `raw.replace(/\\(.)/g, '$1')`
// unescape expects), interleaved with realistic comment noise BETWEEN call
// sites, round-trips back through parseTestTimeouts to the same list, in
// order. Exercises the exact motivating case named in the ticket's own
// commit message (a test name carrying parentheses and an escaped quote)
// across a wide generated space, not just the one real name that prompted
// writing a real scanner instead of a bare regex.
//
// Deliberately does NOT put the literal substring "test(" inside generated
// comments/strings: parseTestTimeouts's own call-SITE detection regex
// (`callRegex`) is not itself comment/string-aware (only the argument
// scan - scanBalanced/splitTopLevelArgs - is, which is what the module's
// own header claims). That is a real, narrow, accepted scope limit for a
// tool built to parse 3 named files, not a general-purpose JS parser -
// probing it would manufacture a misleading failure unrelated to what this
// property actually verifies (string/comment-aware ARGUMENT scanning).
//
// Non-vacuity, checked by hand before landing: dropping the `- 1` in
// skipStringLiteral's return (`return i + 1;` unchanged, but corrupting
// scanBalanced's own `i = skipStringLiteral(text, i) - 1` call site to
// `i = skipStringLiteral(text, i)` instead) desyncs the scanner by one
// character on the very first quoted name and fails within the first
// handful of generated cases; reverted and reconfirmed green.

const NAME_CHAR = fc.stringMatching(/^[\x20-\x7E]{1,40}$/);

function escapeForSingleQuote(name) {
  return name.replace(/([\\'])/g, '\\$1');
}

function formatCall(name, timeoutMs) {
  const nameLit = `'${escapeForSingleQuote(name)}'`;
  const args = timeoutMs === null ? `${nameLit}, () => {}` : `${nameLit}, () => {}, ${timeoutMs}`;
  return `test(${args});`;
}

const NOISE_LINES = [
  '// this call needs headroom for a subprocess run',
  '/* heavy - do not lower this without re-measuring */',
  "const decoy = 'not a call site';",
];

function buildSource(specs) {
  return specs
    .map((s, idx) => `${NOISE_LINES[idx % NOISE_LINES.length]}\n${formatCall(s.name, s.timeoutMs)}`)
    .join('\n\n');
}

const specArb = fc.record({
  name: NAME_CHAR,
  timeoutMs: fc.option(fc.integer({ min: 1, max: 999999 }), { nil: null }),
});

test('property: parseTestTimeouts round-trips name/timeout pairs through quote, paren and comment noise', () => {
  fc.assert(
    fc.property(fc.array(specArb, { minLength: 1, maxLength: 8 }), (specs) => {
      const source = buildSource(specs);
      const parsed = parseTestTimeouts(source);
      assert.deepEqual(
        parsed,
        specs.map((s) => ({ name: s.name, timeoutMs: s.timeoutMs }))
      );
    }),
    { numRuns: 200 }
  );
});

test('property: a call with no trailing numeric argument always parses as timeoutMs: null', () => {
  fc.assert(
    fc.property(NAME_CHAR, (name) => {
      const source = `test('${escapeForSingleQuote(name)}', () => {});`;
      const parsed = parseTestTimeouts(source);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].timeoutMs, null);
    }),
    { numRuns: 100 }
  );
});
