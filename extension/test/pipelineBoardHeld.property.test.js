'use strict';

// BL-1045 property test (coder-authored, TWO declared invariants).
//
//   Invariant 1 (never in-flight): a held ticket appears in its own section,
//   never in a role column and never as not-started, because no role holds it.
//   Invariant 2 (at least as complete as the reader): every ticket the reader
//   hands the board appears somewhere on the board, or the board states how
//   many it left out - never a silent omission.
//
// WHY PROPERTIES AND NOT MORE FIXTURES. Both quantify over "every backlog
// state the folders could be in". The fixtures pin the shapes a reviewer
// thinks of; the omission that matters is the one nobody wrote down - the id
// that is somehow in two folders at once mid-park, or a cap that silently eats
// the very ticket the section exists for.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Three states a naive generator would essentially never produce:
//
//   (a) OVERFLOW. A held list drawn uniformly from a small range would exceed
//       PIPELINE_BOARD_HELD_MAX rarely, so a silent cap would survive most
//       runs. Over-cap lists are constructed, with a floor.
//
//   (b) THE SAME ID IN TWO PLACES AT ONCE. This is the collision shape BL-654
//       warns about: role-held ids and held ids drawn independently would
//       collide essentially never. So the role-held/paused/active sets are
//       DERIVED FROM the held set - the exact overlap a mid-park tick
//       produces, where the coordinator has moved the file but the mailbox
//       still names the ticket - and every generated case is a
//       double-render candidate by construction.
//
//   (c) AN UNDERIVABLE HOLD DATE. mtime-free age derivation means some
//       tickets have no date at all. Drawing timestamps uniformly would
//       essentially never produce one, and "age unknown" sorting as if it
//       were the oldest would push a real twelve-day ticket off the cap.
//       Absent dates are drawn deliberately and floored.

const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  PIPELINE_BOARD_HELD_MAX,
  PIPELINE_BOARD_NOT_STARTED_COLUMN,
  computePipelineBoard,
  formatHeldForLabel,
  renderPipelineBoardBody,
} = require('../out/concierge/pipelineBoard');

const RUNS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);

const ticketId = fc.integer({ min: 800, max: 899 }).map((n) => `BL-${n}`);

// Reach (c): a real spread of ages AND underivable ones.
const heldSince = fc.oneof(
  { arbitrary: fc.integer({ min: 1, max: 40 }).map((d) => NOW - d * DAY_MS), weight: 6 },
  { arbitrary: fc.constant(undefined), weight: 2 }
);

const heldSet = fc
  .uniqueArray(fc.record({ id: ticketId, heldSinceMs: heldSince }), {
    minLength: 1,
    maxLength: PIPELINE_BOARD_HELD_MAX + 6,
    selector: (item) => item.id,
  })
  .map((items) => items.map((item) => ({ ...item, title: `${item.id} title`, filename: `${item.id}.yaml` })));

// ──────────────────────────────────────────────────────────────────────────
// Invariant 1 — never in-flight.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 1: no held ticket ever reaches a role column, the not-started column, or PARKED', async () => {
  const reached = { overlaps: 0, overCap: 0, unknownAges: 0 };

  fc.assert(
    // Weighted so the mid-park overlap - the collision this property exists
    // for - is the common case rather than a coin flip that often lands on
    // "no overlap at all", which tests nothing.
    fc.property(heldSet, fc.constantFrom(0, 0.5, 0.75, 1, 1, 1), (held, overlapFraction) => {
      // Reach (b): the role-held / paused / active sets are DERIVED from the
      // held set - the mid-park overlap a real tick produces.
      const overlapCount = Math.floor(held.length * overlapFraction);
      const overlapping = held.slice(0, overlapCount).map((h) => h.id);
      if (overlapCount > 0) reached.overlaps += 1;
      if (held.length > PIPELINE_BOARD_HELD_MAX) reached.overCap += 1;
      reached.unknownAges += held.filter((h) => h.heldSinceMs === undefined).length;

      const data = computePipelineBoard(
        { coder: overlapping, cleaner: ['BL-999'] },
        overlapping.map((id) => ({ id })),
        {},
        { nowMs: NOW, held, activeIds: [...overlapping, 'BL-999'] }
      );

      const heldIds = new Set(held.map((h) => h.id));
      for (const row of data.rows) {
        assert.ok(!heldIds.has(row.id), `held ticket ${row.id} was rendered in column ${row.column}`);
      }
      assert.ok(
        !data.rows.some((r) => r.column === PIPELINE_BOARD_NOT_STARTED_COLUMN && heldIds.has(r.id)),
        'no role holds a held ticket, so it is not merely not-started'
      );
      for (const entry of data.parked ?? []) {
        assert.ok(!heldIds.has(entry.id), `held ticket ${entry.id} was rendered as parked`);
      }
      // It IS on the board - the exclusions above must not have deleted it.
      const shown = new Set((data.held ?? []).map((h) => h.id));
      const omitted = data.heldOmittedCount ?? 0;
      assert.equal(shown.size + omitted, heldIds.size);
      return true;
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.overlaps >= 60, `mid-park overlaps too rare: ${reached.overlaps}`);
  assert.ok(reached.overCap >= 30, `over-cap held lists too rare: ${reached.overCap}`);
  assert.ok(reached.unknownAges >= 60, `underivable hold dates too rare: ${reached.unknownAges}`);
});

test('invariant 1: the rendered board never shows a held id twice', () => {
  fc.assert(
    fc.property(heldSet, (held) => {
      const data = computePipelineBoard(
        { coder: held.map((h) => h.id) },
        held.map((h) => ({ id: h.id })),
        {},
        { nowMs: NOW, held, activeIds: held.map((h) => h.id) }
      );
      const body = renderPipelineBoardBody(data);
      for (const item of held.slice(0, PIPELINE_BOARD_HELD_MAX)) {
        const shortId = item.id.replace(/^BL-/, '');
        const occurrences = body.split('\n').filter((line) => line.trim().startsWith(`${shortId} `)).length;
        assert.ok(occurrences <= 1, `${item.id} appeared ${occurrences} times on the board`);
      }
      return true;
    }),
    { numRuns: RUNS }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 2 — at least as complete as the reader, never silently short.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 2: every held ticket is shown or counted, and the count is stated on the board', () => {
  const reached = { overCap: 0, withinCap: 0 };

  fc.assert(
    fc.property(heldSet, (held) => {
      const data = computePipelineBoard({}, [], {}, { nowMs: NOW, held });
      const shown = data.held ?? [];
      const omitted = data.heldOmittedCount ?? 0;

      assert.equal(shown.length + omitted, held.length, 'a held ticket went missing entirely');
      assert.ok(shown.length <= PIPELINE_BOARD_HELD_MAX);

      const body = renderPipelineBoardBody(data);
      if (omitted > 0) {
        reached.overCap += 1;
        assert.ok(body.includes(`+${omitted} more held`), `the cap was silent: ${body}`);
      } else {
        reached.withinCap += 1;
        assert.ok(!/more held/.test(body), 'an overflow line appeared with nothing omitted');
      }
      // Every SHOWN ticket is actually on the rendered board, not merely in
      // the data structure.
      for (const entry of shown) {
        assert.ok(
          body.includes(entry.id.replace(/^BL-/, '')),
          `${entry.id} is in the data but not on the rendered board`
        );
      }
      return true;
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.overCap >= 30, `over-cap cases too rare - the cap would be untested: ${reached.overCap}`);
  assert.ok(reached.withinCap >= 30, `within-cap cases too rare: ${reached.withinCap}`);
});

test('invariant 2: the cap can only ever drop the newest, never the longest-held', () => {
  fc.assert(
    fc.property(heldSet, (held) => {
      const data = computePipelineBoard({}, [], {}, { nowMs: NOW, held });
      const shown = new Set((data.held ?? []).map((h) => h.id));
      if ((data.heldOmittedCount ?? 0) === 0) {
        return true;
      }
      // The oldest DERIVABLE hold date must have survived the cap: the
      // twelve-day ticket is the entire reason this section exists.
      const dated = held.filter((h) => h.heldSinceMs !== undefined);
      if (dated.length === 0) {
        return true;
      }
      const oldest = dated.reduce((a, b) => (a.heldSinceMs <= b.heldSinceMs ? a : b));
      assert.ok(shown.has(oldest.id), `the longest-held ticket ${oldest.id} was the one hidden by the cap`);
      return true;
    }),
    { numRuns: RUNS }
  );
});

test('invariant 2: an age is never rendered as a number it cannot support', () => {
  fc.assert(
    fc.property(fc.option(fc.integer({ min: 0, max: NOW }), { nil: undefined }), (since) => {
      const label = formatHeldForLabel(since, NOW);
      if (since === undefined) {
        assert.equal(label, 'age unknown', 'an unknown age must say so, never read as zero');
      } else {
        assert.ok(/^(\d+[dhm]|just now)$/.test(label), `unrenderable age label "${label}"`);
      }
      return true;
    }),
    { numRuns: RUNS }
  );
});
