const assert = require('node:assert/strict');
const { decisionLineFor, composeDecidedAskText, alreadyDecidedToastText } = require('../out/concierge/approvalAskClosing');

// BL-484: a decided approval ask must close itself - this is the PURE core
// (verdict + instant -> decision line / edited text / stale-tap toast). No
// I/O; Telegram edit/answer calls stay in the thin adapters that call this.

test('decisionLineFor: an approved verdict records the verdict and the UTC decision time', () => {
  const nowMs = Date.UTC(2026, 6, 17, 3, 7);
  assert.equal(decisionLineFor({ kind: 'approved' }, nowMs), '-- Approved 2026-07-17 03:07 UTC');
});

test('decisionLineFor: pads single-digit month/day/hour/minute', () => {
  const nowMs = Date.UTC(2026, 0, 5, 3, 7);
  assert.equal(decisionLineFor({ kind: 'approved' }, nowMs), '-- Approved 2026-01-05 03:07 UTC');
});

test('decisionLineFor: a rejected verdict records the verdict and the reason', () => {
  assert.equal(decisionLineFor({ kind: 'rejected', reason: 'bad scope' }, 0), '-- Rejected: bad scope');
});

test('decisionLineFor: is a pure function of its inputs - same verdict/instant, same line', () => {
  const nowMs = 1752696300000;
  assert.equal(decisionLineFor({ kind: 'approved' }, nowMs), decisionLineFor({ kind: 'approved' }, nowMs));
});

test('composeDecidedAskText: keeps the original ask text above the appended decision line', () => {
  const original = 'BL-484 needs your approval before it can proceed. Reply here with "approve BL-484"...';
  const nowMs = Date.UTC(2026, 6, 17, 3, 7);
  const text = composeDecidedAskText(original, { kind: 'approved' }, nowMs);
  const lines = text.split('\n');
  assert.equal(lines[0], original, 'expected the original ask text preserved verbatim above the decision line');
  assert.equal(lines[1], '-- Approved 2026-07-17 03:07 UTC');
});

test('composeDecidedAskText: a rejected verdict appends the reason below the original text', () => {
  const original = 'BL-484 needs your approval...';
  const text = composeDecidedAskText(original, { kind: 'rejected', reason: 'bad scope' }, 0);
  assert.equal(text, `${original}\n-- Rejected: bad scope`);
});

test('alreadyDecidedToastText: names the approved verdict', () => {
  assert.equal(alreadyDecidedToastText('approved'), 'Already decided: approved');
});

test('alreadyDecidedToastText: names the rejected verdict', () => {
  assert.equal(alreadyDecidedToastText('rejected'), 'Already decided: rejected');
});

// BL-490: an Expedite tap is a decision too - it closes the ask through the
// SAME routine, with its own "-- Expedited <UTC>" line (never an "Approved"
// line, so the topic audit trail distinguishes an ordinary approve from a
// jump-the-queue expedite).

test('decisionLineFor: an expedited verdict records the Expedited verb and the UTC decision time', () => {
  const nowMs = Date.UTC(2026, 6, 17, 3, 7);
  assert.equal(decisionLineFor({ kind: 'expedited' }, nowMs), '-- Expedited 2026-07-17 03:07 UTC');
});

test('composeDecidedAskText: an expedited verdict appends the Expedited line below the original text', () => {
  const original = 'BL-490 needs your approval...';
  const nowMs = Date.UTC(2026, 6, 17, 3, 7);
  const text = composeDecidedAskText(original, { kind: 'expedited' }, nowMs);
  assert.equal(text, `${original}\n-- Expedited 2026-07-17 03:07 UTC`);
});

// BL-509: an Amend reply is a decision too - unlike approve/reject/expedite
// it is NOT terminal (the specifier flips it back to pending on re-present,
// slice 3), but it still closes the posted ask through the SAME routine,
// with its own "-- Amending <UTC>" line.

test('decisionLineFor: an amending verdict records the Amending verb and the UTC decision time', () => {
  const nowMs = Date.UTC(2026, 6, 17, 3, 7);
  assert.equal(decisionLineFor({ kind: 'amending' }, nowMs), '-- Amending 2026-07-17 03:07 UTC');
});

test('composeDecidedAskText: an amending verdict appends the Amending line below the original text', () => {
  const original = 'BL-509 needs your approval...';
  const nowMs = Date.UTC(2026, 6, 17, 3, 7);
  const text = composeDecidedAskText(original, { kind: 'amending' }, nowMs);
  assert.equal(text, `${original}\n-- Amending 2026-07-17 03:07 UTC`);
});
