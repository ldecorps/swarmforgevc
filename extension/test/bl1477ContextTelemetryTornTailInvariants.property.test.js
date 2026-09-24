'use strict';

// BL-1477 declared invariants:
//
// 1. context_telemetry_store.bb read-events! and
//    contextTelemetryProducer.ts readPersistedContextEvents return the same
//    records for the same store file, whatever torn bytes its tail carries.
// 2. No tick of the producer records past its cap or runs past its
//    deadline; events it did not reach are recorded by later ticks in
//    timestamp order and no event is recorded twice.
// 3. A record appended to the store always starts on its own line: the
//    writer never glues a record onto a torn tail, so tolerance of a torn
//    FINAL line never becomes interior damage on the next append.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { readPersistedContextEvents, selectEventsWithinLimits } = require('../out/metrics/contextTelemetryProducer');

const REPO_ROOT = path.join(__dirname, '..', '..');
const STORE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'context_telemetry_store.bb');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');

function wholeEvent(sessionId) {
  return {
    agent: 'coder',
    role: 'coder',
    session_id: sessionId,
    timestamp: '2026-07-09T11:38:10.165Z',
    input_tokens: 1,
    output_tokens: 1,
    context_utilization_pct: 1,
    compaction: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  };
}

// A NUL run (a pure zero-fill tail, the real 2026-08-30 shape) or a
// "GARBAGE_..." token (a mid-write text fragment) - never valid JSON either
// way, whether or not NUL bytes are interspersed into it, since it can
// never start with a JSON literal's own first character.
const garbageArb = fc.oneof(
  fc.integer({ min: 1, max: 40 }).map((n) => '\u0000'.repeat(n)),
  fc
    .string({ minLength: 0, maxLength: 12 })
    .map((suffix) => `GARBAGE_${suffix.replace(/\u0000/g, '')}`)
);

// bb reads its OWN store lib directly (invariant 1 names read-events!
// itself, not the CLI) - a bb -e one-liner mirrors the existing unit test's
// bbReadEvents helper, but also captures a thrown exception rather than
// letting bb's own non-zero exit go unobserved.
function bbReadReport(stateDir) {
  const res = spawnSync(
    'bb',
    ['-e', `(load-file "${STORE_LIB}") (println (cheshire.core/generate-string (context-telemetry-store/read-events-report! "${stateDir}")))`],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) {
    return { threw: true };
  }
  const lastLine = res.stdout.trim().split('\n').pop();
  const parsed = JSON.parse(lastLine);
  return { threw: false, events: parsed.events, tornTailLine: parsed['torn-tail-line'] ?? null };
}

function tsReadReport(telemetryDir) {
  try {
    const result = readPersistedContextEvents(telemetryDir);
    return { threw: false, events: result.events, tornTailLine: result.tornTailLine };
  } catch {
    return { threw: true };
  }
}

function writeStore(telemetryDir, content) {
  fs.mkdirSync(telemetryDir, { recursive: true });
  fs.writeFileSync(path.join(telemetryDir, 'context-events.jsonl'), content, 'utf8');
}

test('property (invariant 1): the bb and TS readers agree on every store shape - whole, torn-tail, or interior-damaged', () => {
  const DAMAGE_KINDS = ['none', 'tornTail', 'interior'];
  const PER_CELL_RUNS = runsPerCell(30, DAMAGE_KINDS.length);
  const seen = { none: 0, tornTail: 0, interior: 0 };
  const caseArbFor = (damageKindCell) =>
    fc
      .integer({ min: 2, max: 5 })
      .chain((wholeCount) =>
        fc.tuple(
          fc.constant(wholeCount),
          fc.constant(damageKindCell),
          garbageArb,
          fc.integer({ min: 0, max: wholeCount - 1 })
        )
      );

  for (const damageKindCell of DAMAGE_KINDS) {
  fc.assert(
    fc.property(caseArbFor(damageKindCell), ([wholeCount, damageKind, garbage, interiorIndex]) => {
      seen[damageKind] += 1;
      const dir = mkTmpDir('sfvc-bl1477-inv1-');
      const wholeLines = Array.from({ length: wholeCount }, (_, i) => JSON.stringify(wholeEvent(`w${i}`)));

      let content;
      let expectTornAtLine = null;
      if (damageKind === 'none') {
        content = `${wholeLines.join('\n')}\n`;
      } else if (damageKind === 'tornTail') {
        content = `${wholeLines.join('\n')}\n${garbage}`;
        expectTornAtLine = wholeCount + 1;
      } else {
        const before = wholeLines.slice(0, interiorIndex);
        const after = wholeLines.slice(interiorIndex);
        content = `${[...before, garbage, ...after].join('\n')}\n`;
      }
      writeStore(dir, content);

      const tsResult = tsReadReport(dir);
      const bbResult = bbReadReport(dir);

      if (damageKind === 'interior') {
        assert.equal(tsResult.threw, true, 'TS reader should refuse interior damage');
        assert.equal(bbResult.threw, true, 'bb reader should refuse interior damage');
        return;
      }

      assert.equal(tsResult.threw, false, 'TS reader should not throw on a whole store or a torn tail');
      assert.equal(bbResult.threw, false, 'bb reader should not throw on a whole store or a torn tail');
      assert.equal(tsResult.events.length, wholeCount);
      assert.equal(bbResult.events.length, wholeCount);
      assert.deepEqual(
        tsResult.events.map((e) => e.session_id).sort(),
        bbResult.events.map((e) => e.session_id).sort()
      );
      assert.equal(tsResult.tornTailLine, expectTornAtLine);
      assert.equal(bbResult.tornTailLine, expectTornAtLine);
    }),
    { numRuns: PER_CELL_RUNS }
  );
  }

  assertReachFloor(seen, DAMAGE_KINDS, PER_CELL_RUNS, 'damage-kind');
});

test('property (invariant 2): a tick never exceeds its cap or its deadline, and nothing is lost or duplicated across ticks', () => {
  // BL-1691: three cells, each parameter set constructed to GUARANTEE its
  // own stop reason - a small cap with a never-tripping deadline for
  // capBound, a generous cap with a fast-tripping deadline for
  // deadlineBound, and a generous cap with a never-tripping deadline for
  // exhausted - rather than hoping the four-way draw happened to land there.
  const STOP_REASON_CELLS = {
    capBound: () =>
      fc.record({
        eventCount: fc.integer({ min: 3, max: 20 }),
        cap: fc.constant(1),
        deadlineMs: fc.constant(10_000_000),
        stepMs: fc.constant(0),
      }),
    deadlineBound: () =>
      fc.integer({ min: 3, max: 20 }).map((n) => ({ eventCount: n, cap: n, deadlineMs: 500, stepMs: 1000 })),
    exhausted: () =>
      fc.integer({ min: 1, max: 20 }).map((n) => ({ eventCount: n, cap: n, deadlineMs: 100, stepMs: 0 })),
  };
  const CELLS = Object.keys(STOP_REASON_CELLS);
  const PER_CELL_RUNS = runsPerCell(60, CELLS.length);
  const seen = { capBound: 0, deadlineBound: 0, exhausted: 0 };
  for (const cell of CELLS) {
  fc.assert(
    fc.property(
      STOP_REASON_CELLS[cell](),
      ({ eventCount, cap, deadlineMs, stepMs }) => {
        const events = Array.from({ length: eventCount }, (_, i) => wholeEvent(`e${i}`));
        // clock[0] is the call inside selectEventsWithinLimits' own `start`;
        // clock[k] (k>=1) is the call made right after selecting the k-th
        // event, so elapsed after k selections is exactly clock[k]-clock[0].
        const clock = Array.from({ length: eventCount + 1 }, (_, i) => i * stepMs);
        let callIndex = 0;
        const nowFn = () => clock[callIndex++];

        const { selected, remaining } = selectEventsWithinLimits(events, cap, deadlineMs, nowFn);

        // No loss, no duplication, no reordering: selected+remaining is a
        // straight partition of the input, oldest-first (the input is
        // already sorted this way, mirroring runContextTelemetryProducer's
        // own pre-sort before calling this function).
        assert.deepEqual([...selected, ...remaining], events);
        assert.ok(selected.length <= cap, `selected ${selected.length} exceeded cap ${cap}`);

        const elapsedAtStop = clock[selected.length] - clock[0];
        if (remaining.length > 0) {
          // The tick stopped early only for one of its two allowed reasons.
          const stoppedForCap = selected.length === cap;
          const stoppedForDeadline = elapsedAtStop >= deadlineMs;
          assert.ok(
            stoppedForCap || stoppedForDeadline,
            `tick stopped with ${remaining.length} events left over for no allowed reason (selected=${selected.length}, cap=${cap}, elapsed=${elapsedAtStop}, deadline=${deadlineMs})`
          );
          if (stoppedForCap) seen.capBound += 1;
          if (stoppedForDeadline) seen.deadlineBound += 1;
          assert.notEqual(cell, 'exhausted', `the 'exhausted' cell's own construction stopped early instead`);
        } else {
          seen.exhausted += 1;
          assert.equal(cell, 'exhausted', `cell ${cell}'s own construction exhausted instead of stopping early for its intended reason`);
        }
      }
    ),
    { numRuns: PER_CELL_RUNS }
  );
  }

  assertReachFloor(seen, CELLS, PER_CELL_RUNS, 'stop-reason');
});

test('property (invariant 2, multi-tick face): repeated ticks record every event exactly once, in order, respecting the cap each time', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 15 }), (eventCount, cap) => {
      const events = Array.from({ length: eventCount }, (_, i) => wholeEvent(`m${i}`));
      let remaining = events;
      const recordedOrder = [];
      let ticks = 0;
      const maxTicks = eventCount + 1;
      while (remaining.length > 0 && ticks < maxTicks) {
        const { selected, remaining: nextRemaining } = selectEventsWithinLimits(remaining, cap, Number.MAX_SAFE_INTEGER, () => 0);
        assert.ok(selected.length <= cap, `tick ${ticks} recorded more than the cap`);
        assert.ok(selected.length > 0, 'a tick with events remaining and no deadline pressure recorded nothing');
        recordedOrder.push(...selected);
        remaining = nextRemaining;
        ticks += 1;
      }
      assert.deepEqual(recordedOrder, events, 'every event should be recorded exactly once, in order');
      assert.equal(remaining.length, 0, 'events were left over after enough ticks to cover them all');
    }),
    { numRuns: 30 }
  );
});

test('property (invariant 3): appending after a torn NUL tail drops it instead of leaving permanent interior damage', () => {
  const seen = { withGarbageInterleaved: 0 };
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 4000 }),
      fc.integer({ min: 1, max: 4 }),
      (wholeCount, nulRunLength, appendCount) => {
        seen.withGarbageInterleaved += 1;
        const dir = mkTmpDir('sfvc-bl1477-inv3-');
        const wholeLines = Array.from({ length: wholeCount }, (_, i) => JSON.stringify(wholeEvent(`p${i}`)));
        writeStore(dir, `${wholeLines.join('\n')}\n${'\u0000'.repeat(nulRunLength)}`);

        for (let i = 0; i < appendCount; i += 1) {
          const args = [
            CLI,
            'record',
            '--agent', 'coder',
            '--role', 'coder',
            '--session-id', `append-${i}`,
            '--timestamp', `2026-07-09T12:0${i}:00.000Z`,
            '--input-tokens', '1',
            '--output-tokens', '1',
            '--context-utilization-pct', '1',
            '--provider', 'anthropic',
            '--model', 'claude-sonnet-5',
          ];
          const res = spawnSync('bb', args, { encoding: 'utf8', env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: dir } });
          assert.equal(res.status, 0, `record #${i} after a torn tail should not fail: ${res.stderr}`);
        }

        // The torn NUL tail was tolerated (dropped) by the FIRST append, so
        // every subsequent read - here, another read via the same reader
        // invariant 1 already cross-checked - must see every whole record
        // plus every appended one, and never refuse as interior damage.
        const result = tsReadReport(dir);
        assert.equal(result.threw, false, 'a torn tail that was already appended-over reappeared as interior damage');
        assert.equal(result.events.length, wholeCount + appendCount);
        assert.equal(result.tornTailLine, null, 'the dropped torn tail should not be reported again');
      }
    ),
    { numRuns: 20 }
  );
  assert.ok(seen.withGarbageInterleaved >= 1);
});
