'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  interpretFreshnessCliOutput,
  mayPromoteGivenFreshness,
  holdPromoteSideEffects,
  evaluateDeprecatorFreshness,
} = require('../out/tools/deprecate-check');

test('BL-1173 P1: CLI failure / malformed output never interprets as allow', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.constant(''),
        fc.constant('not-json'),
        fc.constant('[]'),
        fc.constant('{"decision":"maybe"}'),
        fc.constant('{"decision":123}'),
        fc.constant('{"foo":"bar"}'),
        fc.string().filter((s) => {
          try {
            const p = JSON.parse(s);
            return !(p && typeof p === 'object' && !Array.isArray(p) && (p.decision === 'allow' || p.decision === 'hold'));
          } catch {
            return true;
          }
        })
      ),
      (raw) => {
        const d = interpretFreshnessCliOutput(raw);
        assert.equal(d.decision, 'hold');
        assert.notEqual(d.decision, 'allow');
      }
    ),
    { numRuns: 80 }
  );
});

test('BL-1173 P1b: well-formed allow stays allow; hold stays hold', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 80 }), (reason) => {
      assert.equal(interpretFreshnessCliOutput('{"decision":"allow"}').decision, 'allow');
      const held = interpretFreshnessCliOutput(JSON.stringify({ decision: 'hold', reason }));
      assert.equal(held.decision, 'hold');
      assert.equal(held.reason, reason);
    }),
    { numRuns: 20 }
  );
});

test('BL-1173 P2: expedite eligibility never bypasses a freshness hold', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.string({ minLength: 1, maxLength: 40 }), (expediteEligible, reason) => {
      const hold = { decision: 'hold', reason };
      assert.equal(mayPromoteGivenFreshness(hold, expediteEligible), false);
      assert.equal(mayPromoteGivenFreshness({ decision: 'allow' }, expediteEligible), true);
    }),
    { numRuns: 40 }
  );
});

test('BL-1173 P3: on hold the ticket stays paused and specifier is notified at priority 00', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 60 }), (reason) => {
      const side = holdPromoteSideEffects({ decision: 'hold', reason });
      assert.equal(side.staysPaused, true);
      assert.equal(side.notifySpecifierPriority00, true);
      const ok = holdPromoteSideEffects({ decision: 'allow' });
      assert.equal(ok.staysPaused, false);
      assert.equal(ok.notifySpecifierPriority00, false);
    }),
    { numRuns: 30 }
  );
});

test('BL-1173 P2b: evaluate hold + mayPromote is closed under random expedite flags', () => {
  fc.assert(
    fc.property(fc.boolean(), (expedite) => {
      const held = evaluateDeprecatorFreshness({
        ticketId: 'BL-9',
        yamlText: 'id: BL-9\n',
        pausedPathExists: true,
        supersedeMarkerPath: '/x/.swarmforge/superseded/BL-9',
        dependsOnIds: [],
        dependsOnAllDone: false,
        doneClosureExists: false,
        retiredSurfaceHits: [],
        specGapBounceCount: 0,
      });
      assert.equal(held.decision, 'hold');
      assert.equal(mayPromoteGivenFreshness(held, expedite), false);
    }),
    { numRuns: 20 }
  );
});
