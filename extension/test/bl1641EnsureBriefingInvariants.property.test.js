'use strict';

// BL-1641 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. The ceremony never adds, replaces or rewrites a docs/briefings/<day>.md
//      that main already has; a forced briefing commit touches exactly that
//      one absent path and nothing else.
//
//      Split in two, per the coder contract's own guidance for an invariant
//      that spans an impure boundary:
//        (a) "never touch a file main already has" is a single early-return
//            guard in landDocumenterBriefing/composeHeadlessBriefing, ahead
//            of every git write - a structural guarantee (no write is
//            reachable past it), verified with real git state by the
//            acceptance e2e (scenarios 01/02 land-or-compose when main has
//            nothing; 03/04 leave main's tip byte-identical when it
//            already has the file or nothing is producible) rather than
//            fuzzed here: it quantifies over real repository state, not a
//            pure module fast-check can drive cheaply.
//        (b) "a forced commit touches exactly that one path" is
//            documenterCommitIsPureAdd, a pure function extracted for
//            exactly this reason - fuzzed below.
//   2. Every forced path is recorded in the ceremony sequence and surfaced
//      loudly; a forced briefing is never silent, and a deadline with
//      nothing producible still stops the swarm as BL-658 built it.
//      Fuzzed against runNightClosingCeremony with mocked land/compose
//      deps - every (landed, composed) combination the executor can see.
//
// GENERATOR REACH is constructed, not hoped for. Invariant 1b's touched-path
// arrays are drawn to include the exact relPath as often as not, and to
// include extra/other paths as often as not - both "pure add" and "not a
// pure add" are certain to be drawn, not merely possible. Invariant 2 draws
// all three outcomes (landed, composed-only, neither) by construction via
// fc.constantFrom over the two booleans/values, driving the ceremony to its
// hard deadline the same way the unit-level integration tests do (two ticks
// past the drain and briefing budgets).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { documenterCommitIsPureAdd, runNightClosingCeremony } = require('../out/tools/night-closing-ceremony-run');

describe('BL-1641 declared invariants', () => {
  it('inv1b: documenterCommitIsPureAdd is true iff the touched paths are exactly [relPath]', () => {
    const reach = { pure: 0, extraPaths: 0, wrongPath: 0, empty: 0 };

    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes('\n')), { maxLength: 4 }),
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes('\n')),
        // Half the time, force relPath itself into the drawn array so the
        // "exactly this one path" case is reached often, not by luck.
        fc.boolean(),
        (otherPaths, relPath, includeRelPath) => {
          const touchedPaths = includeRelPath ? [...otherPaths, relPath] : otherPaths;
          const result = documenterCommitIsPureAdd(touchedPaths, relPath);
          const expected = touchedPaths.length === 1 && touchedPaths[0] === relPath;
          assert.equal(result, expected);

          if (touchedPaths.length === 0) {
            reach.empty += 1;
            assert.equal(result, false, 'an empty diff can never be "exactly this one path"');
          } else if (touchedPaths.length === 1 && touchedPaths[0] === relPath) {
            reach.pure += 1;
            assert.equal(result, true);
          } else if (touchedPaths.length > 1) {
            reach.extraPaths += 1;
            assert.equal(result, false, 'more than one touched path must never read as a pure add');
          } else {
            reach.wrongPath += 1;
            assert.equal(result, false, 'a single touched path that is not relPath must never read as a pure add');
          }
        },
      ),
      { numRuns: 200 },
    );

    assert.ok(reach.pure > 0, `generator never reached the pure-add case: ${JSON.stringify(reach)}`);
    assert.ok(reach.extraPaths > 0, `generator never reached the extra-paths case: ${JSON.stringify(reach)}`);
  });

  function makeMockedRunDeps(landedSha, composed) {
    const state = { current: null };
    const notesLog = [];
    return {
      state,
      notesLog,
      deps: {
        readConf: () => '',
        evaluate: () => ({
          mode: 'ceremony',
          scheduleState: 'ok',
          surfaced: 'nothing',
          consultFixedMorningTrigger: false,
          ceremonyDue: false,
          ceremonyBeginLocal: '05:25',
          closureStopLocal: '08:45',
          drainBudgetMinutes: 1,
          briefingBudgetMinutes: 1,
        }),
        readState: () => state.current,
        writeState: (_t, s) => {
          state.current = s;
        },
        scanInFlight: () => ({ count: 0, roles: [] }),
        scanHeld: () => [],
        readActiveRole: () => 'coder',
        briefingSent: () => false,
        applyFreeze: () => {},
        rotateDocumenter: () => {},
        instructBriefing: () => {},
        nightStop: () => {},
        surface: (_t, code) => notesLog.push(code),
        recordCnp: () => {},
        deliverLeanPacket: () => [],
        recordEmptyOutcome: () => [],
        workedAShift: () => true,
        landDocumenterBriefing: () => landedSha,
        composeHeadlessBriefing: () => composed,
      },
    };
  }

  it('inv2: every ensure-briefing outcome is recorded in sequence, surfaced loudly, never silent', () => {
    const reach = { landed: 0, composedOnly: 0, neither: 0 };

    fc.assert(
      fc.property(
        fc.constantFrom(null, 'a1b2c3d4e5'),
        fc.boolean(),
        (landedSha, composed) => {
          const { deps, notesLog } = makeMockedRunDeps(landedSha, composed);
          const t0 = 10_000_000_000; // fixed, arbitrary - a sleep-relative clock, never the real one
          runNightClosingCeremony('/tmp/bl1641-inv2', '/tmp/conf', t0, deps, false, 'finish-shift');
          runNightClosingCeremony('/tmp/bl1641-inv2', '/tmp/conf', t0 + 65_000, deps, false, 'finish-shift');
          const result = runNightClosingCeremony(
            '/tmp/bl1641-inv2',
            '/tmp/conf',
            t0 + 130_000,
            deps,
            false,
            'finish-shift',
          );

          // Never silent: closing-briefing-missing is surfaced on EVERY
          // deadline path, whatever ensure-briefing's own outcome is.
          assert.ok(
            notesLog.includes('closing-briefing-missing'),
            `closing-briefing-missing was not surfaced: ${JSON.stringify(notesLog)}`,
          );
          assert.ok(result.state.sequence.includes('briefing-missing'));
          assert.equal(result.state.sequence[result.state.sequence.length - 1], 'swarm-stopped');

          if (landedSha) {
            reach.landed += 1;
            assert.ok(
              result.state.sequence.includes('briefing-landed-from-documenter'),
              `expected the landed step recorded: ${result.state.sequence.join(' -> ')}`,
            );
            assert.ok(!result.state.sequence.includes('briefing-composed-headless'));
          } else if (composed) {
            reach.composedOnly += 1;
            assert.ok(
              result.state.sequence.includes('briefing-composed-headless'),
              `expected the composed step recorded: ${result.state.sequence.join(' -> ')}`,
            );
            assert.ok(!result.state.sequence.includes('briefing-landed-from-documenter'));
          } else {
            reach.neither += 1;
            // Nothing producible: the night still ends exactly as BL-658
            // built it - no forced step, the last two steps unchanged.
            assert.deepEqual(result.state.sequence.slice(-2), ['briefing-missing', 'swarm-stopped']);
            assert.ok(!result.state.sequence.includes('briefing-landed-from-documenter'));
            assert.ok(!result.state.sequence.includes('briefing-composed-headless'));
          }
        },
      ),
      { numRuns: 60 },
    );

    assert.ok(reach.landed > 0, `generator never reached landed: ${JSON.stringify(reach)}`);
    assert.ok(reach.composedOnly > 0, `generator never reached composed-only: ${JSON.stringify(reach)}`);
    assert.ok(reach.neither > 0, `generator never reached neither: ${JSON.stringify(reach)}`);
  });
});
