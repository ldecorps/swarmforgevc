'use strict';

// BL-1721's one declared invariant: "A per-file budget refusal never
// rests on a confirmation it did not report: every new-pole line names
// the alone duration or each confirmation failure with its reason."
//
// checkFileDurationBudget/formatBudgetOffenders (check-suite-file-
// budget.ts) are the pure core - exhaustively enumerated here over every
// confirmAlone outcome shape, never fc-sampled (this session's own
// precedent for a state space this small): a first attempt that succeeds
// under/at/over budget (no retry - a real failure never even happens),
// and a first attempt that fails, branching into a retry that succeeds
// under/at-or-over budget or fails too.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLI_MODULE = path.join(__dirname, '..', 'out', 'tools', 'check-suite-file-budget.js');

// Runs in a fresh node process per case so a hand-built confirmAlone stub
// (a plain JS closure, not serializable across a bb/JSON bridge) can be
// authored directly, while still driving the REAL, compiled production
// module - never a reimplementation of the decision under test.
function run(firstOutcome, secondOutcome) {
  const script = `
    const { checkFileDurationBudget, formatBudgetOffenders } = require(${JSON.stringify(CLI_MODULE)});
    const outcomes = [${JSON.stringify(firstOutcome)}, ${secondOutcome ? JSON.stringify(secondOutcome) : 'null'}];
    let calls = 0;
    const confirmAlone = () => {
      const outcome = outcomes[calls];
      calls += 1;
      return outcome;
    };
    const result = checkFileDurationBudget(
      [{ file: 'test/f.test.js', durationMs: 10900 }],
      7000,
      [],
      new Set(),
      confirmAlone
    );
    const offenderLine = result.offenders.length > 0 ? formatBudgetOffenders(result.offenders) : null;
    console.log(JSON.stringify({ verdict: result.verdict, calls, offenderLine }));
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return JSON.parse(out.trim());
}

const UNDER = { ms: 4000 };
const AT = { ms: 7000 };
const OVER = { ms: 9000 };
const FAIL = { failed: 'stand-in reason' };

describe('invariant: every offender line names what the confirmation reported - an alone duration, or every failure reason - never a bare in-suite number', () => {
  const CASES = [
    { name: 'first attempt succeeds under budget', first: UNDER, second: null, expectVerdict: 'contention', expectCalls: 1 },
    { name: 'first attempt succeeds exactly at budget', first: AT, second: null, expectVerdict: 'new-pole', expectCalls: 1 },
    { name: 'first attempt succeeds over budget', first: OVER, second: null, expectVerdict: 'new-pole', expectCalls: 1 },
    { name: 'first fails, retry succeeds under budget', first: FAIL, second: UNDER, expectVerdict: 'contention', expectCalls: 2 },
    { name: 'first fails, retry succeeds at budget', first: FAIL, second: AT, expectVerdict: 'new-pole', expectCalls: 2 },
    { name: 'first fails, retry succeeds over budget', first: FAIL, second: OVER, expectVerdict: 'new-pole', expectCalls: 2 },
    { name: 'first fails, retry fails too', first: FAIL, second: FAIL, expectVerdict: 'new-pole', expectCalls: 2 },
  ];

  it('reaches and correctly classifies every constructed confirmation-outcome shape', () => {
    const reach = new Set();
    for (const { name, first, second, expectVerdict, expectCalls } of CASES) {
      reach.add(name);
      const { verdict, calls, offenderLine } = run(first, second);
      assert.equal(verdict, expectVerdict, `expected verdict "${expectVerdict}" for "${name}", got: ${verdict}`);
      assert.equal(calls, expectCalls, `expected exactly ${expectCalls} confirmAlone call(s) for "${name}", got: ${calls}`);
      if (verdict === 'new-pole') {
        assert.ok(offenderLine, `expected an offender line for "${name}"`);
        const namesAlone = /confirmed alone/.test(offenderLine);
        const namesFailures = /confirmation failed/.test(offenderLine);
        assert.ok(
          namesAlone || namesFailures,
          `expected the offender line for "${name}" to name an alone duration or a confirmation failure, got: ${offenderLine}`
        );
        if (second && 'failed' in second) {
          assert.match(offenderLine, /stand-in reason.*stand-in reason/s, `expected BOTH failure reasons named for "${name}", got: ${offenderLine}`);
        }
      }
    }
    assert.equal(reach.size, CASES.length, 'reach floor: expected every constructed case to run');
  });
});
