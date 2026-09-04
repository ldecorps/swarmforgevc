'use strict';

// BL-1362 hardener: direct unit coverage of parseArgs, exported specifically
// for testability ("split out so the CLI's own main() stays the thin wrapper
// ... and the parsing is testable with no process at all") but never actually
// unit-tested - the CLI test drives recordReviewEvidence directly and never
// reaches parseArgs's own 13-branch argv walk. CRAP flagged it: complexity
// 13, 5% covered, CRAP 156.70.

const assert = require('node:assert/strict');
const { parseArgs, USAGE } = require('../out/tools/recordReviewEvidenceArgs');

test('parses --ticket/--role with no verdict flags', () => {
  const result = parseArgs(['--ticket', 'BL-9362', '--role', 'architect']);
  assert.deepEqual(result, { ticket: 'BL-9362', role: 'architect', none: false, items: [], date: undefined });
});

test('parses --none', () => {
  const result = parseArgs(['--ticket', 'BL-9362', '--role', 'QA', '--none']);
  assert.equal(result.none, true);
  assert.deepEqual(result.items, []);
});

test('parses --date as an override', () => {
  const result = parseArgs(['--ticket', 'BL-9362', '--role', 'QA', '--none', '--date', '20260101']);
  assert.equal(result.date, '20260101');
});

test('parses a single valid --item as a JSON object', () => {
  const item = { command: 'npm test', commit: 'abc1234567', excerpt: 'x', class: 'unit', expected: 'y', blamed: 'coder', remediation: 'a.ts::f' };
  const result = parseArgs(['--ticket', 'BL-9362', '--role', 'hardener', '--item', JSON.stringify(item)]);
  assert.deepEqual(result.items, [item]);
});

test('accumulates multiple --item flags in order', () => {
  const item1 = { command: 'a' };
  const item2 = { command: 'b' };
  const result = parseArgs([
    '--ticket', 'BL-9362', '--role', 'hardener',
    '--item', JSON.stringify(item1),
    '--item', JSON.stringify(item2),
  ]);
  assert.deepEqual(result.items, [item1, item2]);
});

test('rejects a flag with no following value', () => {
  assert.equal(parseArgs(['--ticket']), null);
  assert.equal(parseArgs(['--ticket', 'BL-9362', '--role']), null);
});

test('rejects --item whose value is not valid JSON', () => {
  assert.equal(parseArgs(['--ticket', 'BL-9362', '--role', 'hardener', '--item', 'not-json']), null);
});

test('rejects --item whose value is valid JSON but not an object (string, number, null, boolean)', () => {
  // Every JSON scalar shape .parse() can return that is NOT an object - the
  // `typeof parsed !== 'object'` half of the guard, plus JSON's own null,
  // which IS typeof 'object' in JS and needs the explicit `!parsed` half.
  // Arrays are deliberately NOT in this list - see the next test: `typeof []
  // === 'object'` in JS, so the guard as written passes an array through.
  for (const value of ['"a string"', '42', 'null', 'true']) {
    assert.equal(
      parseArgs(['--ticket', 'BL-9362', '--role', 'hardener', '--item', value]),
      null,
      `expected --item ${value} to be refused`
    );
  }
});

test('an --item that is a JSON array is NOT refused (typeof [] === "object" in JS)', () => {
  // Documents the guard's actual reach rather than an assumed one: `!parsed
  // || typeof parsed !== 'object'` only excludes non-object primitives and
  // null. An array satisfies `typeof === 'object'`, so it passes through
  // exactly as a `{}` object would - this parser layer does not validate the
  // ITEM's shape (no ARTICLE_44_ITEM_FIELDS check here), only that something
  // parseable and object-typed was supplied. Shape validation, if any, is a
  // different layer's job.
  const result = parseArgs(['--ticket', 'BL-9362', '--role', 'hardener', '--item', '[]']);
  assert.deepEqual(result.items, [[]]);
});

test('accepts an empty JSON object as an --item (shape validation is not this layer\'s job)', () => {
  const result = parseArgs(['--ticket', 'BL-9362', '--role', 'hardener', '--item', '{}']);
  assert.deepEqual(result.items, [{}]);
});

test('rejects an unrecognized flag', () => {
  assert.equal(parseArgs(['--ticket', 'BL-9362', '--role', 'hardener', '--bogus', 'x']), null);
});

test('rejects a missing --ticket', () => {
  assert.equal(parseArgs(['--role', 'hardener', '--none']), null);
});

test('rejects a missing --role', () => {
  assert.equal(parseArgs(['--ticket', 'BL-9362', '--none']), null);
});

test('rejects an empty argv (no ticket, no role)', () => {
  assert.equal(parseArgs([]), null);
});

test('USAGE names both the --none and --item invocation shapes', () => {
  assert.match(USAGE, /--none/);
  assert.match(USAGE, /--item/);
  assert.match(USAGE, /--ticket/);
  assert.match(USAGE, /--role/);
});
