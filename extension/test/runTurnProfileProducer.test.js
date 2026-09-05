'use strict';

const assert = require('node:assert/strict');
const { formatTurnProfileResult } = require('../out/tools/run-turn-profile-producer');

// BL-1364: formatTurnProfileResult is the pure CLI-output formatter split out
// of main() per the CLI thin-wrapper rule (engineering.prompt) - main() itself
// stays untested, but the logic it delegates to must be, or its 4-way branch
// is 0%-covered code masquerading as a thin wrapper.

test('formatTurnProfileResult reports INCOMPLETE when the window has unreadable transcripts', () => {
  const result = formatTurnProfileResult({ recorded: 0, updated: 0, stages: [], complete: false });
  assert.equal(result, 'INCOMPLETE window has unreadable transcripts; no stage reports a share');
});

test('formatTurnProfileResult reports SKIPPED when a complete window has no classified turns', () => {
  const result = formatTurnProfileResult({ recorded: 0, updated: 0, stages: [], complete: true });
  assert.equal(result, 'SKIPPED no classified turns in the window');
});

test('formatTurnProfileResult reports RECORDED (singular) for exactly one new record', () => {
  const result = formatTurnProfileResult({ recorded: 1, updated: 0, stages: ['coder'], complete: true });
  assert.equal(result, 'RECORDED turn profile for 1 stage(s): coder');
});

test('formatTurnProfileResult reports UPDATED for anything other than exactly one recorded (0 or 2+)', () => {
  const zero = formatTurnProfileResult({ recorded: 0, updated: 1, stages: ['coder', 'cleaner'], complete: true });
  assert.equal(zero, 'UPDATED turn profile for 2 stage(s): coder, cleaner');

  const two = formatTurnProfileResult({ recorded: 2, updated: 0, stages: ['coder', 'cleaner'], complete: true });
  assert.equal(two, 'UPDATED turn profile for 2 stage(s): coder, cleaner');
});

// completeness takes priority over an empty stage list would-be reading -
// incomplete must never be misreported as "skipped, nothing to do".
test('formatTurnProfileResult reports INCOMPLETE even when stages happens to also be empty', () => {
  const result = formatTurnProfileResult({ recorded: 0, updated: 0, stages: [], complete: false });
  assert.notEqual(result, 'SKIPPED no classified turns in the window');
});
