'use strict';

// BL-658 invariant: The morning briefing is produced only as the closing
// sequence's last act — no independent clock can fire it against a stopped
// swarm or separate it from the stop.
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  resolveClosureSchedule,
  resolveCeremonyBegin,
  runClosingCeremony,
  defaultBudgets,
  shouldConsultFixedMorningTrigger,
  formatLocalTime,
} = require('../out/quality/nightClosingCeremony');

const hhmm = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

test('property: usable closure schedule never consults the independent morning clock', () => {
  let okReached = 0;
  let unusableReached = 0;
  fc.assert(
    fc.property(
      fc.oneof(
        hhmm.map((t) => ({ conf: `config closure_stop_local ${t}\n`, kind: 'ok' })),
        fc.constant({ conf: '', kind: 'absent' }),
        fc.tuple(hhmm, hhmm)
          .filter(([a, b]) => a !== b)
          .map(([a, b]) => ({
            conf: `config closure_stop_local ${a}\nconfig closure_stop_local ${b}\n`,
            kind: 'ambiguous',
          }))
      ),
      fc.constantFrom('coder', 'documenter', null),
      fc.boolean(),
      (sched, role, alreadySent) => {
        const schedule = resolveClosureSchedule(sched.conf);
        const r = runClosingCeremony({
          schedule,
          budgets: defaultBudgets(),
          hardDeadline: { hour: 6, minute: 0 },
          inFlight: role ? { role, drainOutcome: 'completes' } : null,
          heldParcelIds: [],
          briefingAlreadySent: alreadySent,
          briefingNeverCommits: false,
        });
        if (schedule.state === 'ok') {
          okReached += 1;
          assert.equal(shouldConsultFixedMorningTrigger(schedule), false);
          assert.equal(r.fixedMorningTriggerConsulted, false);
          assert.equal(r.fixedMorningTriggerFired, false);
          // Briefing acts (committed / already-sent / missing) only appear
          // after freeze and before or as the terminal stop — never alone.
          const freezeIdx = r.sequence.indexOf('freeze-promotion');
          assert.ok(freezeIdx === 0);
          const stopIdx = r.sequence.lastIndexOf('swarm-stopped');
          assert.ok(stopIdx === r.sequence.length - 1);
          const briefingIdx = Math.max(
            r.sequence.indexOf('briefing-committed'),
            r.sequence.indexOf('briefing-already-sent'),
            r.sequence.indexOf('briefing-missing')
          );
          if (briefingIdx >= 0) {
            assert.ok(briefingIdx > freezeIdx);
            assert.ok(briefingIdx < stopIdx);
          }
        } else {
          unusableReached += 1;
          assert.equal(shouldConsultFixedMorningTrigger(schedule), true);
          assert.equal(r.fixedMorningTriggerFired, true);
          assert.equal(r.sequence.includes('briefing-committed'), false);
        }
      }
    ),
    { numRuns: 80 }
  );
  assert.ok(okReached >= 10, `generator must reach ok schedules (got ${okReached})`);
  assert.ok(unusableReached >= 10, `generator must reach unusable schedules (got ${unusableReached})`);
});

test('property: ceremony begin tracks closure by fixed budgets (no second clock)', () => {
  const budgets = defaultBudgets();
  fc.assert(
    fc.property(hhmm, (closureStr) => {
      const schedule = resolveClosureSchedule(`config closure_stop_local ${closureStr}\n`);
      assert.equal(schedule.state, 'ok');
      const begin = resolveCeremonyBegin(schedule.closure, budgets);
      const beginMin =
        begin.hour * 60 + begin.minute;
      const closureMin = schedule.closure.hour * 60 + schedule.closure.minute;
      const delta =
        (closureMin - beginMin + 24 * 60) % (24 * 60);
      assert.equal(delta, budgets.drainBudgetMinutes + budgets.briefingBudgetMinutes);
      assert.equal(formatLocalTime(begin).length, 5);
    }),
    { numRuns: 60 }
  );
});
