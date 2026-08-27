// BL-1036 property test (coder-authored, two DECLARED invariants).
//
//   Invariant 1: "A restart initiated by the supervisor never leaves two
//   holders of the bot token polling at once, whether the old process exited
//   gracefully or was killed outright."
//
//   Invariant 2: "Every degraded-poll report is eventually followed by a
//   recovery report or an unresolved report - the log never leaves a
//   degradation open."
//
// Invariant 2 is a property of a SEQUENCE, not of one cycle, which is exactly
// why the defect survived: every individual cycle behaved correctly and the
// log was still unreadable, because nothing ever closed what it opened. So the
// property replays whole generated runs of cycles through the REAL decisions
// and asserts the opened/closed ledger balances.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// A degradation only OPENS when a failure streak reaches degradedThreshold (5).
// Drawing each cycle's outcome independently at even odds makes a 5-long
// failure run about 1 in 32, so most generated runs would never open a
// degradation at all and the property would quantify over nothing. Runs are
// therefore built from alternating BLOCKS whose failure lengths straddle the
// threshold by construction, with floors on opened, recovered and unresolved.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break applied to the
// real source, compiled and restored:
//
//   recovery notice never raised (the shipped defect) .. invariant 2 FAILS
//   exit before abort on shutdown ...................... invariant 1 FAILS
//
// The second row only became true after fixing a vacuity hole in THIS FILE,
// and the hole is worth recording. Invariant 1 was originally asserted through
// the exit callback alone - a proxy that cannot see the abort at all - so
// swapping the two calls left the assertion completely satisfied and the
// property passed against the exact behaviour it exists to forbid. The fix was
// to inject `abort` alongside `onShutdown` so the real sequence is recorded,
// and to assert the abort/exit PAIR per signal. An ordering property that
// cannot observe both of the things it orders is not testing an ordering.

const assert = require('node:assert/strict');

const {
  shouldRaiseDegradedWarning,
  shouldRaisePollRecoveredNotice,
  shouldRaisePollUnresolvedNotice,
} = require('../out/tools/telegramFrontDeskBotCore');
const { installPollShutdownHandlers } = require('../out/tools/telegram-front-desk-bot');

const RUNS = Number(process.env.PROPERTY_RUNS || 300);
const CONFIG = { degradedThreshold: 5, sustainedOutageThresholdMs: 300000 };

function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

// A run is alternating fail/succeed blocks. Failure block lengths straddle the
// threshold BY CONSTRUCTION, so both "opens a degradation" and "never opens
// one" are reached rather than left to chance.
function generateRun(rng) {
  const cycles = [];
  const blocks = 1 + rng(4);
  for (let b = 0; b < blocks; b++) {
    const failLen = rng(2) === 0 ? rng(CONFIG.degradedThreshold) : CONFIG.degradedThreshold + rng(4);
    for (let i = 0; i < failLen; i++) cycles.push(false);
    const okLen = 1 + rng(3);
    for (let i = 0; i < okLen; i++) cycles.push(true);
  }
  // Some runs end mid-failure and never recover - the unresolved ending.
  if (rng(3) === 0) {
    for (let i = 0; i < CONFIG.degradedThreshold + 2; i++) cycles.push(false);
  }
  return cycles;
}

test('BL-1036 invariant 2: the log never leaves a degradation open', () => {
  const rng = makeRng(1036);
  const coverage = { opened: 0, recovered: 0, unresolved: 0, neverOpened: 0 };

  for (let r = 0; r < RUNS; r++) {
    const cycles = generateRun(rng);
    let failures = 0;
    let open = false;          // a degradation has been announced and not closed
    let openedThisRun = 0;
    let closedThisRun = 0;
    // The sustained-outage ending fires once, at the end of a long tail.
    const tailFailures = (() => {
      let n = 0;
      for (let i = cycles.length - 1; i >= 0 && !cycles[i]; i--) n++;
      return n;
    })();

    cycles.forEach((ok, i) => {
      const prev = failures;
      failures = ok ? 0 : failures + 1;

      if (!ok && shouldRaiseDegradedWarning(failures, CONFIG)) {
        assert.equal(open, false, 'a second degradation must not open while one is still open');
        open = true;
        openedThisRun += 1;
      }
      if (ok && shouldRaisePollRecoveredNotice(prev, 0, CONFIG)) {
        assert.equal(open, true, 'a recovery must close an OPEN degradation, never appear alone');
        open = false;
        closedThisRun += 1;
        coverage.recovered += 1;
      }
      // The run ends still failing past its budget: closed as unresolved.
      const isLast = i === cycles.length - 1;
      if (isLast && !ok && open) {
        const sustained = tailFailures >= CONFIG.degradedThreshold;
        if (shouldRaisePollUnresolvedNotice({ sustainedOutageReached: sustained, alreadyReported: false })) {
          open = false;
          closedThisRun += 1;
          coverage.unresolved += 1;
        }
      }
    });

    coverage.opened += openedThisRun;
    if (openedThisRun === 0) coverage.neverOpened += 1;

    // THE INVARIANT: every degradation this run opened was closed.
    assert.equal(open, false,
      `run ${r} ended with a degradation still open (opened ${openedThisRun}, closed ${closedThisRun})`);
    assert.equal(openedThisRun, closedThisRun,
      `run ${r}: ${openedThisRun} opened but ${closedThisRun} closed - the ledger must balance`);
  }

  assert.ok(coverage.opened >= 200, `degradations opened only ${coverage.opened} times`);
  assert.ok(coverage.recovered >= 100, `recoveries reached only ${coverage.recovered} times`);
  assert.ok(coverage.unresolved >= 30, `unresolved endings reached only ${coverage.unresolved} times`);
  assert.ok(coverage.neverOpened >= 10, `runs that never open a degradation reached only ${coverage.neverOpened}`);
});

test('BL-1036 invariant 1: shutdown always releases the slot before it exits', () => {
  // The ordering is the invariant. Exiting first is precisely the
  // abandon-the-slot behaviour that cost every restart a conflict window, and
  // it is indistinguishable from correct behaviour unless the order is
  // asserted. Repeated and interleaved signals are generated because a
  // supervisor that SIGTERMs then SIGKILLs delivers more than one.
  const rng = makeRng(2036);
  for (let r = 0; r < Math.min(RUNS, 120); r++) {
    const events = [];
    const handlers = {};
    installPollShutdownHandlers(
      { on: (event, listener) => { handlers[event] = listener; } },
      () => events.push('exit'),
      () => events.push('abort')
    );
    const signals = 1 + rng(3);
    for (let i = 0; i < signals; i++) {
      const sig = rng(2) === 0 ? 'SIGTERM' : 'SIGINT';
      assert.doesNotThrow(() => handlers[sig](), 'a repeated signal must never throw on the way out');
    }
    // THE INVARIANT, observed directly: every shutdown released the slot
    // BEFORE it exited. Recorded as a real sequence rather than inferred.
    assert.equal(events.length, signals * 2, 'each signal must both abort and exit');
    for (let i = 0; i < signals; i++) {
      assert.equal(events[i * 2], 'abort', `signal ${i}: the slot must be released first`);
      assert.equal(events[i * 2 + 1], 'exit', `signal ${i}: and only then exit`);
    }
  }
});
