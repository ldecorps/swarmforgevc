const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  parseVocabulary,
  renderVocabulary,
  readVocabulary,
  vocabularyPath,
  seedVocabularyIfMissing,
  withValue,
  promoteVocabulary,
  STARTER_VOCABULARY,
} = require('../out/bridge/intakeVocabularyStore');

function mkTmp() {
  return mkTmpDir('sfvc-intake-vocab-');
}

test('render/parse round-trips the starter vocabulary', () => {
  const text = renderVocabulary(STARTER_VOCABULARY);
  assert.deepEqual(parseVocabulary(text), STARTER_VOCABULARY);
});

test('parseVocabulary unescapes quoted values', () => {
  const text = 'actor:\n  - "a \\"quoted\\" actor"\naction:\ngoal:\n';
  assert.deepEqual(parseVocabulary(text).actor, ['a "quoted" actor']);
});

test('readVocabulary returns an empty vocabulary when the file is missing', () => {
  const root = mkTmp();
  assert.deepEqual(readVocabulary(root), { actor: [], action: [], goal: [] });
});

test('seedVocabularyIfMissing writes the starter list once', () => {
  const root = mkTmp();
  seedVocabularyIfMissing(root);
  assert.deepEqual(readVocabulary(root), STARTER_VOCABULARY);
  // A second call must not clobber a since-modified file.
  const modified = withValue(readVocabulary(root), 'actor', 'a night-shift reviewer');
  fs.writeFileSync(vocabularyPath(root), renderVocabulary(modified));
  seedVocabularyIfMissing(root);
  assert.ok(readVocabulary(root).actor.includes('a night-shift reviewer'));
});

test('withValue appends a new value', () => {
  const vocab = { actor: ['the human'], action: [], goal: [] };
  const next = withValue(vocab, 'actor', 'a night-shift reviewer');
  assert.deepEqual(next.actor, ['the human', 'a night-shift reviewer']);
});

test('withValue is a no-op for a value already present', () => {
  const vocab = { actor: ['the human'], action: [], goal: [] };
  const next = withValue(vocab, 'actor', 'the human');
  assert.equal(next, vocab);
});

test('withValue trims whitespace and ignores a blank value', () => {
  const vocab = { actor: [], action: [], goal: [] };
  assert.deepEqual(withValue(vocab, 'actor', '  padded  ').actor, ['padded']);
  assert.equal(withValue(vocab, 'actor', '   '), vocab);
});

test('promoteVocabulary folds new values into the shared, durable file', () => {
  const root = mkTmp();
  seedVocabularyIfMissing(root);
  promoteVocabulary(root, { goal: 'sleep through the night' });
  assert.ok(readVocabulary(root).goal.includes('sleep through the night'));
});

// BL-1732 property-lane find: a value carrying a bare backslash or an
// embedded newline used to break the render/parse round-trip - the
// backslash escaped only the closing quote's own `\"`, and a real
// newline split one entry across two physical lines the line-based
// parser can never rejoin.
test('render/parse round-trips a value carrying a bare backslash', () => {
  const vocab = { actor: ['a path like C:\\repo\\file'], action: [], goal: [] };
  assert.deepEqual(parseVocabulary(renderVocabulary(vocab)), vocab);
});

test('render/parse round-trips a value ending in a backslash', () => {
  const vocab = { actor: ['trailing backslash\\'], action: [], goal: [] };
  assert.deepEqual(parseVocabulary(renderVocabulary(vocab)), vocab);
});

test('render/parse round-trips a value carrying an embedded newline', () => {
  const vocab = { actor: ['line one\nline two'], action: [], goal: [] };
  assert.deepEqual(parseVocabulary(renderVocabulary(vocab)), vocab);
});

test('render/parse round-trips a value carrying an embedded carriage return', () => {
  const vocab = { actor: ['line one\rline two'], action: [], goal: [] };
  assert.deepEqual(parseVocabulary(renderVocabulary(vocab)), vocab);
});

// BL-1732 hardener: 'parseVocabulary unescapes quoted values' above only
// drives the DECODE side of escaping, with hand-written already-escaped
// text - it never calls renderVocabulary on a value carrying a literal
// `"`. Mutating escapeVocabValue's `.replace(/"/g, '\\"')` to
// `.replace(/"/g, '')` survived the whole existing suite: it silently
// STRIPS every quote character from a value instead of escaping it, and
// nothing round-trips a value through renderVocabulary to notice.
test('render/parse round-trips a value carrying a literal double-quote character', () => {
  const vocab = { actor: ['a "quoted" actor'], action: [], goal: [] };
  assert.deepEqual(parseVocabulary(renderVocabulary(vocab)), vocab);
});

// BL-1732 hardener: renderVocabulary's rendered form is meant to be
// human-editable (backlog/vocabulary/intake-narrative.yaml, per BL-1733's
// own human-deletion feature) - a blank line separating each slot's block
// is what makes that readable. Mutating the outer `.join('\n')` (joining
// the three slot blocks) to `.join('')` survived: parseVocabulary skips
// blank lines regardless, so the round trip is unaffected either way, but
// the rendered text itself loses its section spacing.
test('renderVocabulary separates each slot block with a blank line', () => {
  const text = renderVocabulary(STARTER_VOCABULARY);
  assert.match(text, /"\n\naction:/);
  assert.match(text, /"\n\ngoal:/);
});

// BL-1732 hardener: slotMatch (/^(actor|action|goal):\s*$/) and itemMatch
// (/^\s*-\s*"((?:[^"\\]|\\.)*)"\s*$/) both anchor at line start and end -
// renderVocabulary's own output never exercises the boundary (it always
// emits a canonical "actor:\n" / '  - "value"\n' shape), so every anchor
// survived Stryker's sweep until driven with hand-crafted, non-round-trip
// text the way a human hand-editing this tracked file plausibly could
// produce. Each assertion below isolates ONE anchor:
//  - no leading "^": a line with leading garbage before "actor:"/"- " must
//    NOT be read as a header/item (only a genuine anchor rejects it).
//  - no trailing "$": a line with trailing garbage after the recognized
//    part must NOT be read as a header/item (only the anchor rejects it).
//  - "\S*$" in place of "\s*$": trailing WHITESPACE after a clean
//    header/item must still be accepted (only "\s" tolerates it).
test('parseVocabulary rejects a slot header with leading text before it (no false "^" match)', () => {
  const text = 'xactor:\n  - "should not be filed"\n';
  assert.deepEqual(parseVocabulary(text), { actor: [], action: [], goal: [] });
});

test('parseVocabulary rejects a slot header line carrying trailing text after the colon (no false "$" match)', () => {
  const text = 'actor: not actually a clean header\n  - "should not be filed"\n';
  assert.deepEqual(parseVocabulary(text), { actor: [], action: [], goal: [] });
});

test('parseVocabulary accepts a slot header with trailing whitespace after the colon', () => {
  const text = 'actor:   \n  - "a value"\n';
  assert.deepEqual(parseVocabulary(text).actor, ['a value']);
});

test('parseVocabulary rejects an item line with leading text before the dash (no false "^" match)', () => {
  const text = 'actor:\nxyz  - "should not be filed"\n';
  assert.deepEqual(parseVocabulary(text).actor, []);
});

test('parseVocabulary rejects an item line carrying trailing text after the closing quote (no false "$" match)', () => {
  const text = 'actor:\n  - "a value" trailing garbage\n';
  assert.deepEqual(parseVocabulary(text).actor, []);
});

test('parseVocabulary accepts an item line with trailing whitespace after the closing quote', () => {
  const text = 'actor:\n  - "a value"   \n';
  assert.deepEqual(parseVocabulary(text).actor, ['a value']);
});

// BL-1732 hardener: itemMatch's second \s* (between the dash and the
// opening quote) is zero-or-more - renderVocabulary always emits exactly
// one space there ("  - \"value\""), so narrowing it to require exactly
// one space (\s, no *) survives every round-trip test unnoticed. Only a
// hand-crafted line with ZERO spaces between the dash and the quote
// differentiates the two.
test('parseVocabulary accepts an item line with no space between the dash and the quote', () => {
  const text = 'actor:\n  -"a value"\n';
  assert.deepEqual(parseVocabulary(text).actor, ['a value']);
});

test('promoteVocabulary with no additions leaves the vocabulary unchanged', () => {
  const root = mkTmp();
  seedVocabularyIfMissing(root);
  promoteVocabulary(root, {});
  assert.deepEqual(readVocabulary(root), STARTER_VOCABULARY);
});

// BL-1732 hardener: `if (value)` in promoteVocabulary's forEach guards
// against a PRESENT key whose value is explicitly `undefined`
// (Object.keys includes such a key; additions[slot] then reads
// undefined) - `{}` above never exercises it, since Object.keys({})
// iterates zero times either way, and an empty-string value would no-op
// via withValue's own falsy-trim guard regardless of this one. Mutating
// `if (value)` to `if (true)` survived for exactly that reason on an
// empty string; only an explicit `undefined` value differentiates,
// since withValue('actor', undefined) calls `undefined.trim()` and
// throws - which `if (value)` exists to prevent.
test('promoteVocabulary skips a present key whose value is explicitly undefined, never throws', () => {
  const root = mkTmp();
  seedVocabularyIfMissing(root);
  const result = promoteVocabulary(root, { actor: undefined });
  assert.deepEqual(result, STARTER_VOCABULARY);
  assert.deepEqual(readVocabulary(root), STARTER_VOCABULARY);
});
