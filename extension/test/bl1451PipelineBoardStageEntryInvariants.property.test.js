'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computePipelineBoard, renderPipelineBoardBody, HEALTH_DOT_GLYPHS } = require('../out/concierge/pipelineBoard');

// BL-1451 declared invariants (backlog/done/M8/BL-1451-the-board-renders-
// bl670s-stage-entries.yaml):
// 1. Every stage-entry field the board renders or carries (health dot;
//    status and as-of for BL-940) comes from BL-670's readTicketStageMap
//    entries, never re-derived by the board or its adapters (BL-670
//    invariant 2: one derivation, two consumers).
// 2. A ticket with no entry, or an entry without a dot, renders exactly as
//    today: the stage cells, the grid line width and every other section
//    are byte-identical (BL-585's width budget stands).
// Coder-authored property tests per BL-654; runs only via npm run
// test:properties.
//
// Non-vacuity proven by hand at authoring time: (1) buildGridRows.stageEntry
// mutated to `{...ticketStageEntries[id], status: 'mutated-...'}` (a
// re-derivation, not the map's own object) failed invariant 1 on the first
// mapped ticket generated; (2) gridCaptionLine's dot changed to
// `row.stageEntry?.healthDot ?? 'green'` (a default instead of "no dot at
// all") passed the relative with-vs-baseline comparison (both sides
// default identically) but failed the absolute "this board declared no
// dot anywhere, so the render must show none" assertion on the first
// generated board - which is exactly why that absolute check exists
// alongside the relative one. Both mutations restored after.

const ticketArb = fc.record({
  hasEntry: fc.boolean(),
  status: fc.constantFrom('claimed', 'in-transit-to', 'last-known'),
  asOf: fc.option(fc.constantFrom('2026-01-01T00:00:00Z', '2026-06-15T12:30:00Z'), { nil: undefined }),
  healthDot: fc.constantFrom('green', 'yellow', 'red'),
});

const boardArb = fc.array(ticketArb, { minLength: 1, maxLength: 12 });

function activeIdsFor(shape) {
  return shape.map((_, i) => `BL-${9000 + i}`);
}

function metaFor(activeIds) {
  const ticketMeta = {};
  activeIds.forEach((id) => {
    ticketMeta[id] = { title: `ticket ${id}` };
  });
  return ticketMeta;
}

// ── Invariant 1 ────────────────────────────────────────────────────────────
// Every ticket independently gets an entry or not, WITH a dot - the fuller
// shape, so this property exercises the same "mapped, health-dot-bearing
// ticket" case invariant 2 deliberately excludes.

function buildFullEntries(shape, activeIds) {
  const ticketStageEntries = {};
  shape.forEach((t, i) => {
    if (t.hasEntry) {
      ticketStageEntries[activeIds[i]] = {
        stage: 'coder',
        status: t.status,
        ...(t.asOf !== undefined ? { asOf: t.asOf } : {}),
        healthDot: t.healthDot,
      };
    }
  });
  return ticketStageEntries;
}

test("BL-1451 invariant 1: every mapped row carries exactly BL-670's own entry object, never a re-derived one", () => {
  let mappedSeen = 0;
  let unmappedSeen = 0;
  fc.assert(
    fc.property(boardArb, (shape) => {
      const activeIds = activeIdsFor(shape);
      const ticketMeta = metaFor(activeIds);
      const ticketStageEntries = buildFullEntries(shape, activeIds);
      const data = computePipelineBoard({ coder: activeIds }, [], ticketMeta, { activeIds, ticketStageEntries });
      for (const row of data.rows) {
        const expected = ticketStageEntries[row.id];
        if (expected) {
          assert.deepEqual(row.stageEntry, expected, `row ${row.id} stageEntry diverges from the map's own entry`);
          mappedSeen += 1;
        } else {
          assert.equal(row.stageEntry, undefined, `unmapped row ${row.id} carries a stageEntry`);
          unmappedSeen += 1;
        }
      }
    }),
    { numRuns: 150 }
  );
  assert.ok(mappedSeen >= 30, `only ${mappedSeen} mapped rows exercised`);
  assert.ok(unmappedSeen >= 30, `only ${unmappedSeen} unmapped rows exercised`);
});

// ── Invariant 2 ────────────────────────────────────────────────────────────
// Every ticket is either unmapped or mapped WITHOUT a dot - the whole board
// never carries a single health dot - and the assertion is the STRONGEST
// form of "renders exactly as today": the full rendered body, byte for
// byte, against the pre-BL-1451 shape (no ticketStageEntries argument at
// all), not a restated per-line expectation that could itself drift.

function buildDotlessEntries(shape, activeIds) {
  const ticketStageEntries = {};
  shape.forEach((t, i) => {
    if (t.hasEntry) {
      ticketStageEntries[activeIds[i]] = {
        stage: 'coder',
        status: t.status,
        ...(t.asOf !== undefined ? { asOf: t.asOf } : {}),
        // Deliberately no healthDot field - the invariant's "entry without
        // a dot" half.
      };
    }
  });
  return ticketStageEntries;
}

test('BL-1451 invariant 2: no entry or a dot-less entry renders byte-identical to no entries at all', () => {
  let mappedDotlessSeen = 0;
  fc.assert(
    fc.property(boardArb, (shape) => {
      const activeIds = activeIdsFor(shape);
      const ticketMeta = metaFor(activeIds);
      const ticketStageEntries = buildDotlessEntries(shape, activeIds);
      const withData = computePipelineBoard({ coder: activeIds }, [], ticketMeta, { activeIds, ticketStageEntries });
      const baselineData = computePipelineBoard({ coder: activeIds }, [], ticketMeta, { activeIds });
      const withBody = renderPipelineBoardBody(withData);
      const baselineBody = renderPipelineBoardBody(baselineData);
      assert.equal(withBody, baselineBody, 'a board with only dot-less/absent entries must render byte-identical to no entries at all');
      // Absolute, not merely relative: a mutant that prefixes EVERY row
      // with a fixed default glyph (rather than only a row with a real
      // dot) would make `withBody`/`baselineBody` agree with EACH OTHER
      // while both silently gained a dot neither should carry - so this
      // board, which never declares one anywhere, must show none.
      for (const glyph of Object.values(HEALTH_DOT_GLYPHS)) {
        assert.ok(!withBody.includes(glyph), `no ticket in this board declared a health dot, but the render includes ${glyph}`);
      }
      if (shape.some((t) => t.hasEntry)) mappedDotlessSeen += 1;
    }),
    { numRuns: 150 }
  );
  assert.ok(mappedDotlessSeen >= 30, `only ${mappedDotlessSeen} boards carried a dot-less mapped ticket`);
});
