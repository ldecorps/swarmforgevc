const assert = require('node:assert/strict');
const { stalenessBucket, stripAgeSuffix, composeTitleWithAge, decideTitleAge } = require('../out/concierge/topicTitleAge');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ── stalenessBucket boundaries ────────────────────────────────────────────

test('stalenessBucket: under 1h is fresh', () => {
  assert.equal(stalenessBucket(0), 'fresh');
  assert.equal(stalenessBucket(30 * 60 * 1000), 'fresh');
  assert.equal(stalenessBucket(HOUR_MS - 1), 'fresh');
});

test('stalenessBucket: 1h up to 24h is hours', () => {
  assert.equal(stalenessBucket(HOUR_MS), 'hours');
  assert.equal(stalenessBucket(5 * HOUR_MS), 'hours');
  assert.equal(stalenessBucket(DAY_MS - 1), 'hours');
});

test('stalenessBucket: 1d up to 3d is day', () => {
  assert.equal(stalenessBucket(DAY_MS), 'day');
  assert.equal(stalenessBucket(30 * HOUR_MS), 'day');
  assert.equal(stalenessBucket(3 * DAY_MS - 1), 'day');
});

test('stalenessBucket: 3d and beyond is stale', () => {
  assert.equal(stalenessBucket(3 * DAY_MS), 'stale');
  assert.equal(stalenessBucket(100 * HOUR_MS), 'stale');
});

test('stalenessBucket: never crashes or goes negative on a clock read that lands before lastUpdateMs', () => {
  assert.equal(stalenessBucket(-1000), 'fresh');
});

// ── stripAgeSuffix / composeTitleWithAge (BASE-TITLE SAFETY) ─────────────

test('stripAgeSuffix leaves a title with no suffix unchanged', () => {
  assert.equal(stripAgeSuffix('BL-999 do a thing'), 'BL-999 do a thing');
});

test('stripAgeSuffix removes an hours-bucket suffix', () => {
  assert.equal(stripAgeSuffix('BL-999 do a thing · 3h ago'), 'BL-999 do a thing');
});

test('stripAgeSuffix removes a day-bucket suffix', () => {
  assert.equal(stripAgeSuffix('BL-999 do a thing · 2d ago'), 'BL-999 do a thing');
});

test('stripAgeSuffix removes a stale-bucket suffix', () => {
  assert.equal(stripAgeSuffix('BL-999 do a thing · 3d+ ago'), 'BL-999 do a thing');
});

// Every case above uses a single-digit count; the pattern's own \d+ must
// match MULTIPLE digits too, or a double-digit count (an entirely ordinary
// case - any ticket idle 10+ hours or 10+ days) only strips the last digit,
// leaving a corrupted base title like "BL-999 do a thing · 1" behind.
test('stripAgeSuffix removes a multi-digit hours-bucket suffix in full', () => {
  assert.equal(stripAgeSuffix('BL-999 do a thing · 23h ago'), 'BL-999 do a thing');
});

test('stripAgeSuffix removes a multi-digit day-bucket suffix in full', () => {
  assert.equal(stripAgeSuffix('BL-999 do a thing · 12d ago'), 'BL-999 do a thing');
});

// The pattern is anchored to the END of the string - suffix-shaped text
// that is NOT the title's own tail must never be stripped as if it were
// the age suffix.
test('stripAgeSuffix never strips suffix-shaped text that is not at the very end of the title', () => {
  const title = 'BL-999 do a thing · 3h ago (a literal title, not a real suffix) extra';
  assert.equal(stripAgeSuffix(title), title);
});

test('composeTitleWithAge for the fresh bucket returns the bare base title (no suffix)', () => {
  assert.equal(composeTitleWithAge('BL-999 do a thing', 'fresh', 30 * 60 * 1000), 'BL-999 do a thing');
});

test('composeTitleWithAge for the hours bucket appends "Nh ago"', () => {
  assert.equal(composeTitleWithAge('BL-999 do a thing', 'hours', 3 * HOUR_MS), 'BL-999 do a thing · 3h ago');
});

test('composeTitleWithAge for the day bucket appends "Nd ago"', () => {
  assert.equal(composeTitleWithAge('BL-999 do a thing', 'day', 2 * DAY_MS), 'BL-999 do a thing · 2d ago');
});

test('composeTitleWithAge for the stale bucket appends the fixed "3d+ ago"', () => {
  assert.equal(composeTitleWithAge('BL-999 do a thing', 'stale', 10 * DAY_MS), 'BL-999 do a thing · 3d+ ago');
});

// BL-414 topic-title-age-suffix-04: never accumulate multiple suffixes.
test('composeTitleWithAge strips an existing suffix before appending the new one - no accumulation', () => {
  const result = composeTitleWithAge('BL-999 do a thing · 3h ago', 'day', 2 * DAY_MS);
  assert.equal(result, 'BL-999 do a thing · 2d ago');
  assert.equal(result.split(' · ').length, 2, 'expected exactly one suffix, not an accumulation');
});

// ── decideTitleAge (change-gate) ──────────────────────────────────────────

// BL-414 topic-title-age-suffix-01 (Scenario Outline)
test('decideTitleAge: crossing from fresh into hours edits the title once', () => {
  const decision = decideTitleAge('BL-1 a thing', 0, 3 * HOUR_MS, 'fresh');
  assert.equal(decision.bucket, 'hours');
  assert.equal(decision.title, 'BL-1 a thing · 3h ago');
});

test('decideTitleAge: crossing from hours into day edits the title once', () => {
  const decision = decideTitleAge('BL-1 a thing', 0, 30 * HOUR_MS, 'hours');
  assert.equal(decision.bucket, 'day');
  assert.equal(decision.title, 'BL-1 a thing · 1d ago');
});

test('decideTitleAge: crossing from day into stale edits the title once', () => {
  const decision = decideTitleAge('BL-1 a thing', 0, 10 * DAY_MS, 'day');
  assert.equal(decision.bucket, 'stale');
  assert.equal(decision.title, 'BL-1 a thing · 3d+ ago');
});

// BL-414 topic-title-age-suffix-02
test('decideTitleAge: an unchanged bucket does not request an edit', () => {
  const decision = decideTitleAge('BL-1 a thing', 0, 5 * HOUR_MS, 'hours');
  assert.equal(decision.bucket, 'hours');
  assert.equal(decision.title, undefined, 'expected no title on an unchanged bucket');
});

// BL-414 topic-title-age-suffix-03
test('decideTitleAge: new activity (elapsed resets to fresh) edits the title back to the bare base title', () => {
  const decision = decideTitleAge('BL-1 a thing', 0, 30 * 60 * 1000, 'stale');
  assert.equal(decision.bucket, 'fresh');
  assert.equal(decision.title, 'BL-1 a thing', 'expected the fresh edit to strip any stale-looking suffix');
});

test('decideTitleAge: no lastAnnouncedBucket at all (first ever tick) still edits once', () => {
  const decision = decideTitleAge('BL-1 a thing', 0, 5 * HOUR_MS, undefined);
  assert.equal(decision.bucket, 'hours');
  assert.equal(decision.title, 'BL-1 a thing · 5h ago');
});
