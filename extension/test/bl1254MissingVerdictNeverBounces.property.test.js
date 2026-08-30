'use strict';

// BL-1254 invariant 3, coder-authored per BL-654:
//
//   "No scenario asserts behaviour a later commit in the chain superseded;
//    the contract describes the resulting state at 5de352ed1d."
//
// The acceptance Background checks the FEATURE FILE for that. What it cannot
// check is the substance underneath it: the superseded behaviour was
// 70c5e0e5b0's "a second missing verdict bounces back to the same stage", and
// 5de352ed1d's claim is that a missing verdict NEVER becomes a bounce - it is
// re-invoked while recoveries remain, then failed closed on the absence
// itself. A single hand-picked case cannot show "never"; that is a claim over
// the whole input space, which is what this property drives.
//
// It drives the REAL landed functions in swarmforge/scripts/expedite_lib.bb
// (should-recover-missing-verdict?, finalize-stage-result,
// bounce-payload-valid?) through the acceptance driver's batch mode, so one
// bb process serves a whole run.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(
  REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1254ExpediteDecisionCli.bb'
);

// The driver's own synthetic tag - the one thing 5de352ed1d refuses outright,
// because bouncing on it re-enters the same stage with no new information.
const SYNTHETIC_REASON = 'no-verdict';
const SYNTHETIC_CLASS = 'no-verdict-abandoned';
const MAX_RECOVERIES = 2;

function batch(cases) {
  const out = execFileSync('bb', [CLI, 'batch', JSON.stringify(cases)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

// A collision candidate BY CONSTRUCTION: every generated payload is derived
// from the driver's own tag by a transformation the gate must see through,
// rather than drawn independently and hoped to collide.
//
// The two fields do not admit the same transformations, and that asymmetry is
// itself a review finding rather than a test convenience - see the pinning
// test at the bottom of this file. `reason` is matched case-insensitively by
// the landed gate; `class` is matched exactly (after a trim). So the case
// transforms apply to reason only, and class is derived by the spellings a
// verdict can genuinely reach the gate in.
const REASON_TRANSFORMS = {
  verbatim: (s) => s,
  upper: (s) => s.toUpperCase(),
  titled: (s) => s.replace(/^./, (c) => c.toUpperCase()),
  padded: (s) => `  ${s}  `,
};
const CLASS_TRANSFORMS = {
  verbatim: (s) => s,
  padded: (s) => `  ${s}  `,
};

describe('BL-1254 invariant 3: a missing verdict never becomes a bounce', () => {
  it('re-invokes while recoveries remain, then fails closed on the absence itself', () => {
    // The input space here is FINITE and small (attempt x timed-out x
    // over-budget), so it is enumerated rather than sampled. A reach floor
    // asserted after a random draw is a floor that can miss on an unlucky
    // seed - which is the whole failure mode BL-654's reach requirement warns
    // about - and enumerating removes the question instead of measuring it.
    const cases = [];
    for (let attempt = 0; attempt <= 6; attempt += 1) {
      for (const timedOut of [false, true]) {
        for (const overrun of [false, true]) {
          cases.push({ attempt, timedOut, overrun });
        }
      }
    }
    const decisions = batch(
      cases.map((args) => ({ query: 'recover', args: { ...args, parsed: null } }))
    );

    const reached = { recovering: 0, exhausted: 0, budgetExhausted: 0 };
    decisions.forEach((decision, i) => {
      const { attempt, timedOut, overrun } = cases[i];
      assert.equal(decision.max, MAX_RECOVERIES);

      if (timedOut || overrun) {
        reached.budgetExhausted += 1;
        // A stage that ran out of budget is not a missing-verdict recovery:
        // it fails on the timeout, and still never bounces.
        assert.equal(decision.recover, false);
        assert.equal(decision.finalVerdict, 'fail');
        assert.equal(decision.finalReason, 'stage-timeout');
        return;
      }

      if (attempt < MAX_RECOVERIES) {
        reached.recovering += 1;
        assert.equal(decision.recover, true, `attempt ${attempt} should re-invoke`);
      } else {
        reached.exhausted += 1;
        assert.equal(decision.recover, false, `attempt ${attempt} should stop recovering`);
      }

      // The whole invariant, on every input: the outcome of a missing verdict
      // is never a bounce. 70c5e0e5b0 made it one; 5de352ed1d took that back.
      assert.notEqual(decision.finalVerdict, 'bounce');
      assert.equal(decision.finalVerdict, 'fail');
      assert.equal(decision.finalReason, SYNTHETIC_REASON);
    });

    // Every branch the invariant quantifies over was actually reached - now a
    // fact about the enumeration, not a hope about the draw.
    assert.equal(reached.recovering, MAX_RECOVERIES);
    assert.equal(reached.exhausted, 5);
    assert.equal(reached.budgetExhausted, 21);
  });

  it('refuses every spelling of the synthesized no-verdict bounce', () => {
    // Also finite, and also enumerated for the same reason. Every payload is
    // built BY CONSTRUCTION from the driver's own tag - derived from it by a
    // transformation the gate must see through - rather than drawn beside it
    // and hoped to collide.
    const cases = [];
    for (const [reasonName, reasonT] of Object.entries(REASON_TRANSFORMS)) {
      for (const [className, classT] of Object.entries(CLASS_TRANSFORMS)) {
        for (const field of ['reason', 'class', 'both']) {
          // A keyword reason cannot carry padding or casing: the driver
          // keywordises the parsed verdict, so that spelling is only
          // meaningful verbatim.
          const keywordable = field !== 'class' && reasonName === 'verbatim';
          for (const asKeyword of keywordable ? [false, true] : [false]) {
            cases.push({
              label: `${field}/${reasonName}/${className}${asKeyword ? '/keyword' : ''}`,
              reason: field === 'class' ? '' : reasonT(SYNTHETIC_REASON),
              class: field === 'reason' ? '' : classT(SYNTHETIC_CLASS),
              reasonKeyword: asKeyword,
            });
          }
        }
      }
    }

    const results = batch(
      cases.map(({ reason, class: cls, reasonKeyword }) => ({
        query: 'bounce',
        args: { reason, class: cls, reasonKeyword },
      }))
    );

    results.forEach(({ valid }, i) => {
      assert.equal(
        valid,
        false,
        `a synthesized bounce (${cases[i].label}) was accepted as a real one`
      );
    });

    // Both fields, every transform, and the keyword spelling are all in the
    // enumeration - stated as a count so a transform silently dropped from the
    // tables above fails here rather than shrinking the space unnoticed.
    assert.equal(
      cases.length,
      // 4 reason spellings x 2 class spellings x 3 carriers, plus the keyword
      // reason for the two carriers that have a reason, at each class spelling.
      Object.keys(REASON_TRANSFORMS).length * Object.keys(CLASS_TRANSFORMS).length * 3 +
        Object.keys(CLASS_TRANSFORMS).length * 2
    );
  });

  it('still accepts a bounce that carries something actionable', () => {
    // Non-vacuity: the gate refuses the synthetic tag because it is synthetic,
    // not because it refuses everything.
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        fc.boolean(),
        (text, inClass) => {
          fc.pre(!text.trim().toLowerCase().startsWith(SYNTHETIC_REASON));
          const [{ valid }] = batch([
            {
              query: 'bounce',
              args: inClass ? { reason: '', class: text } : { reason: text, class: '' },
            },
          ]);
          assert.equal(valid, true, `an actionable bounce (${JSON.stringify(text)}) was refused`);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('pins the reason/class case asymmetry this review found', () => {
    // REVIEW FINDING (BL-1254, invariant 1 forbids fixing it here): the landed
    // gate lower-cases `reason` before comparing it to the synthetic tag but
    // compares `class` exactly, so a verdict carrying
    // class: "NO-VERDICT-ABANDONED" is accepted as a real bounce while
    // reason: "NO-VERDICT" is refused.
    //
    // Not live today - the driver only ever synthesizes the lowercase tag, so
    // nothing in the running system reaches this - which is why it is a narrow
    // follow-up rather than a refusal of the chain. Pinned here so the
    // asymmetry cannot drift further unnoticed, and so the follow-up has a
    // red-to-green anchor. This asserts what the code DOES, not what it should
    // do; the follow-up flips it.
    const [lowerClass, upperClass, lowerReason, upperReason] = batch([
      { query: 'bounce', args: { reason: '', class: SYNTHETIC_CLASS } },
      { query: 'bounce', args: { reason: '', class: SYNTHETIC_CLASS.toUpperCase() } },
      { query: 'bounce', args: { reason: SYNTHETIC_REASON, class: '' } },
      { query: 'bounce', args: { reason: SYNTHETIC_REASON.toUpperCase(), class: '' } },
    ]);
    assert.equal(lowerClass.valid, false, 'the lowercase synthetic class must be refused');
    assert.equal(upperClass.valid, true, 'the finding no longer reproduces - update the follow-up');
    assert.equal(lowerReason.valid, false, 'the lowercase synthetic reason must be refused');
    assert.equal(upperReason.valid, false, 'the reason match is meant to be case-insensitive');
  });
});
