'use strict';

const assert = require('node:assert/strict');
const { formatTurnProfileResult, resolveTurnProfileTickDeadlineMs } = require('../out/tools/run-turn-profile-producer');

// BL-1364: formatTurnProfileResult is the pure CLI-output formatter split out
// of main() per the CLI thin-wrapper rule (engineering.prompt) - main() itself
// stays untested, but the logic it delegates to must be, or its branches are
// 0%-covered code masquerading as a thin wrapper.
//
// BL-1476: every result now carries read/listed/partial - the CLI's own
// read-of-listed report and the PARTIAL outcome.

test('formatTurnProfileResult reports INCOMPLETE when the window has unreadable transcripts', () => {
  const result = formatTurnProfileResult({ recorded: 0, updated: 0, stages: [], complete: false, read: 3, listed: 5, partial: false });
  assert.equal(result, 'INCOMPLETE window has unreadable transcripts; no stage reports a share (read 3 of 5)');
});

test('formatTurnProfileResult reports SKIPPED when a complete window has no classified turns', () => {
  const result = formatTurnProfileResult({ recorded: 0, updated: 0, stages: [], complete: true, read: 0, listed: 0, partial: false });
  assert.equal(result, 'SKIPPED no classified turns in the window (read 0 of 0)');
});

test('formatTurnProfileResult reports RECORDED (singular) for exactly one new record', () => {
  const result = formatTurnProfileResult({ recorded: 1, updated: 0, stages: ['coder'], complete: true, read: 1, listed: 40, partial: false });
  assert.equal(result, 'RECORDED turn profile for 1 stage(s): coder (read 1 of 40)');
});

test('formatTurnProfileResult reports UPDATED for anything other than exactly one recorded (0 or 2+)', () => {
  const zero = formatTurnProfileResult({ recorded: 0, updated: 1, stages: ['coder', 'cleaner'], complete: true, read: 0, listed: 40, partial: false });
  assert.equal(zero, 'UPDATED turn profile for 2 stage(s): coder, cleaner (read 0 of 40)');

  const two = formatTurnProfileResult({ recorded: 2, updated: 0, stages: ['coder', 'cleaner'], complete: true, read: 2, listed: 40, partial: false });
  assert.equal(two, 'UPDATED turn profile for 2 stage(s): coder, cleaner (read 2 of 40)');
});

// completeness takes priority over an empty stage list would-be reading -
// incomplete must never be misreported as "skipped, nothing to do".
test('formatTurnProfileResult reports INCOMPLETE even when stages happens to also be empty', () => {
  const result = formatTurnProfileResult({ recorded: 0, updated: 0, stages: [], complete: false, read: 0, listed: 0, partial: false });
  assert.notEqual(result, 'SKIPPED no classified turns in the window (read 0 of 0)');
});

// BL-1476: PARTIAL takes priority over every other branch - a tick that
// stopped at its deadline wrote no row, so `complete`/`stages` describe
// nothing real and must never be read.
test('formatTurnProfileResult reports PARTIAL when the tick stopped at its deadline, regardless of complete/stages', () => {
  const result = formatTurnProfileResult({ recorded: 0, updated: 0, stages: [], complete: false, read: 3, listed: 40, partial: true });
  assert.equal(result, 'PARTIAL read 3 of 40; no window recorded this tick');
});

test('formatTurnProfileResult PARTIAL is never shadowed by a truthy complete/stages', () => {
  const result = formatTurnProfileResult({ recorded: 1, updated: 0, stages: ['coder'], complete: true, read: 3, listed: 40, partial: true });
  assert.match(result, /^PARTIAL /, 'partial must win over every other branch');
});

// BL-1476: the tick deadline is clamped to a quarter of
// SUPERVISOR_IN_SWEEP_BUDGET_MS, same posture as BL-1454's own
// activity-feed-tick-deadline-ms in handoffd.bb - a misconfigured override
// can only make the tick MORE conservative, never less.
function withEnv(vars, fn) {
  const prior = {};
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior[key];
      }
    }
  }
}

test('resolveTurnProfileTickDeadlineMs defaults to 30s when nothing is configured', () => {
  const result = withEnv({ TURN_PROFILE_TICK_DEADLINE_MS: undefined, SUPERVISOR_IN_SWEEP_BUDGET_MS: undefined }, () =>
    resolveTurnProfileTickDeadlineMs()
  );
  assert.equal(result, 30000);
});

test('resolveTurnProfileTickDeadlineMs clamps a configured deadline to a quarter of the sweep budget', () => {
  const result = withEnv({ TURN_PROFILE_TICK_DEADLINE_MS: '30000', SUPERVISOR_IN_SWEEP_BUDGET_MS: '40000' }, () =>
    resolveTurnProfileTickDeadlineMs()
  );
  assert.equal(result, 10000, 'a quarter of 40000 is 10000, tighter than the configured 30000');
});

test('resolveTurnProfileTickDeadlineMs never widens past the configured deadline even with a huge budget', () => {
  const result = withEnv({ TURN_PROFILE_TICK_DEADLINE_MS: '5000', SUPERVISOR_IN_SWEEP_BUDGET_MS: '1000000' }, () =>
    resolveTurnProfileTickDeadlineMs()
  );
  assert.equal(result, 5000, 'the smaller of the two bounds wins');
});

test('resolveTurnProfileTickDeadlineMs ignores a non-positive or non-numeric override, falling back to defaults', () => {
  const zero = withEnv({ TURN_PROFILE_TICK_DEADLINE_MS: '0', SUPERVISOR_IN_SWEEP_BUDGET_MS: undefined }, () =>
    resolveTurnProfileTickDeadlineMs()
  );
  assert.equal(zero, 30000);
  const garbage = withEnv({ TURN_PROFILE_TICK_DEADLINE_MS: 'not-a-number', SUPERVISOR_IN_SWEEP_BUDGET_MS: undefined }, () =>
    resolveTurnProfileTickDeadlineMs()
  );
  assert.equal(garbage, 30000);
});
