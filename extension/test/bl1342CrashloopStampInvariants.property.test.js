'use strict';

// BL-1342's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The vanished-parcel guard catches I/O conditions only: any
//                other exception still propagates out of the read, so a
//                genuine bug is never silently swallowed as a vanished
//                parcel.
//   invariant 2  A parcel skipped as vanished is never delivered, archived
//                or modified - it is left exactly where it was and
//                re-evaluated on the next poll, so the guard can drop no
//                work.
//   invariant 3  The startup grace can only soften a :stalled verdict for a
//                daemon younger than one stall window: an unknown daemon age
//                grants nothing and a :dead verdict is unreachable by it.
//
// All three are properties of the LANDED code (27d6ab8630) and drive it: the
// real `handoff-lib/read-envelope-if-present`, the real daemon's own
// `--poll-once`, and the real `handoffd-supervisor/evaluate-health`. This is
// a review parcel - it confirms or refutes what landed, and never writes a
// certify or waive decision into the hotfix ledger (BL-848).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const {
  HANDOFF_LIB,
  makeFixture,
  removeFixture,
  runPoll,
  restoreVanished,
  neutralizeRaceHook,
  callLanded,
  callSupervisor,
} = require('../../specs/pipeline/steps/lib/bl1342CrashloopStampFixture');

const STALL_MS = 30000;
const STALE_OBSERVATION =
  '{:heartbeat-age-ms 158000 :pending-outbox-age-ms 160000 ' +
  `:stall-ms ${STALL_MS} :in-flight-sweep-age-ms nil :in-sweep-budget-ms 225000}`;

test('BL-1342/BL-654 invariant 1: the guard swallows I/O conditions and nothing else', () => {
  // GENERATOR REACH (by construction, not by luck): each throwable class is
  // its own case, so the run cannot pass without having exercised both a
  // genuine I/O failure and a non-I/O one. Drawing a class from a weighted
  // pool would let a pass happen with the dangerous half never reached -
  // which is exactly how a widened catch would ship unnoticed.
  const IO_CLASSES = [
    'java.io.FileNotFoundException',
    'java.io.IOException',
    'java.io.EOFException',
  ];
  const NON_IO_CLASSES = [
    'java.lang.IllegalStateException',
    'java.lang.NullPointerException',
    'java.lang.IllegalArgumentException',
    'java.lang.ArithmeticException',
    'java.lang.RuntimeException',
  ];
  const reach = { io: 0, nonIo: 0 };

  const check = (classNames, expectVanished) => {
    fc.assert(
      fc.property(fc.constantFrom(...classNames), fc.string({ maxLength: 16 }), (className, message) => {
        if (expectVanished) reach.io += 1;
        else reach.nonIo += 1;
        const [result] = callLanded(
          HANDOFF_LIB,
          `(emit (try
                   (with-redefs [slurp (fn [& _] (throw (new ${className} ${JSON.stringify(message || 'boom')})))]
                     {:answer (handoff-lib/read-envelope-if-present "/tmp/whatever.handoff")})
                   (catch Exception e {:propagated (.getName (class e))})))`,
        );
        if (expectVanished) {
          assert.deepEqual(
            result,
            { answer: { vanished: true } },
            `an I/O failure (${className}) was not answered as a vanished parcel: ${JSON.stringify(result)}`,
          );
        } else {
          assert.deepEqual(
            result,
            { propagated: className },
            `a non-I/O failure (${className}) was swallowed as a vanished parcel: ${JSON.stringify(result)}`,
          );
        }
        return true;
      }),
      { numRuns: 4 },
    );
  };

  check(IO_CLASSES, true);
  check(NON_IO_CLASSES, false);

  assert.ok(reach.io >= IO_CLASSES.length - 1, 'never exercised a genuine I/O failure');
  assert.ok(reach.nonIo >= NON_IO_CLASSES.length - 1, 'never exercised a non-I/O failure - the dangerous half');
});

test('BL-1342/BL-654 invariant 2: a skipped parcel is left as found and re-evaluated later', () => {
  // The fixture reproduces the live race: an ordinary parcel the sending role
  // archives while the same poll is still delivering the parcel ahead of it.
  // Whatever the parcel's body, the guard must neither deliver, archive,
  // modify nor forget it.
  let runs = 0;
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 40 }).map((s) => s.replace(/[\r\n]/g, ' ')), (body) => {
      runs += 1;
      const fx = makeFixture({ unreadable: true });
      try {
        const original = fs.readFileSync(fx.vanishingPath, 'utf8').replace(/parcel the sender archives mid-poll/, body);
        fs.writeFileSync(fx.vanishingPath, original);

        const first = runPoll(fx);
        assert.equal(first.status, 0, `the poll died on the vanished parcel: ${first.out.slice(-400)}`);
        assert.match(first.log, /outbox-parcel-unreadable/, 'the vanished parcel was not recorded as skipped');

        // Not delivered.
        assert.ok(
          !fs.readdirSync(fx.inbox).some((f) => f.includes('000002')),
          'the skipped parcel was delivered',
        );
        // Not archived by the daemon anywhere of its own.
        for (const box of ['failed', 'sent', 'quarantine', 'completed']) {
          const dir = path.join(fx.outbox, '..', box);
          const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
          assert.ok(!entries.some((f) => f.includes('000002')), `the skipped parcel was moved to ${box}`);
        }
        // Not modified.
        assert.equal(fs.readFileSync(fx.archivedPath, 'utf8'), original, 'the skipped parcel was modified');

        // And not forgotten: once it is readable again, the next poll
        // delivers it.
        restoreVanished(fx);
        neutralizeRaceHook(fx);
        const second = runPoll(fx);
        assert.equal(second.status, 0, `the second poll failed: ${second.out.slice(-400)}`);
        assert.ok(
          fs.readdirSync(fx.inbox).some((f) => f.includes('000002')),
          'the once-skipped parcel was never re-evaluated',
        );
        return true;
      } finally {
        removeFixture(fx);
      }
    }),
    { numRuns: 2 },
  );
  assert.ok(runs > 0, 'the race was never exercised');
}, 120000);

test('BL-1342/BL-654 invariant 3: the grace only softens :stalled, only for a known young age', () => {
  // GENERATOR REACH (by construction): the four cases the verdict turns on
  // are enumerated, and the ages inside each are drawn. The boundary itself
  // (exactly one stall window) is its own case - an off-by-one there is the
  // difference between a bounded grace and an unbounded one.
  const CASES = {
    young: { alive: true, age: fc.integer({ min: 0, max: STALL_MS }), expect: 'healthy' },
    boundary: { alive: true, age: fc.constant(STALL_MS), expect: 'healthy' },
    old: { alive: true, age: fc.integer({ min: STALL_MS + 1, max: STALL_MS * 100 }), expect: 'stalled' },
    unknown: { alive: true, age: fc.constant(null), expect: 'stalled' },
    // Aliveness is the outer gate: no age may reach past it.
    deadYoung: { alive: false, age: fc.integer({ min: 0, max: STALL_MS }), expect: 'dead' },
    deadOld: { alive: false, age: fc.integer({ min: STALL_MS + 1, max: STALL_MS * 100 }), expect: 'dead' },
  };
  const reach = Object.fromEntries(Object.keys(CASES).map((k) => [k, 0]));

  for (const [name, spec] of Object.entries(CASES)) {
    fc.assert(
      fc.property(spec.age, (age) => {
        reach[name] += 1;
        const [verdict] = callSupervisor(
          `(emit (handoffd-supervisor/evaluate-health
                   (assoc ${STALE_OBSERVATION} :alive? ${spec.alive} :daemon-age-ms ${age === null ? 'nil' : age})))`,
        );
        assert.equal(
          verdict,
          spec.expect,
          `age ${age} (alive=${spec.alive}) read ${verdict}, expected ${spec.expect}`,
        );
        return true;
      }),
      { numRuns: 3 },
    );
  }

  for (const [name, count] of Object.entries(reach)) {
    assert.ok(count > 0, `never exercised the ${name} case`);
  }
});
