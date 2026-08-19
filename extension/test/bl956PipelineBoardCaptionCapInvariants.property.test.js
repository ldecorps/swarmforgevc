const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  computePipelineBoard,
  renderPipelineBoardBody,
  composePipelineBoardHtml,
  deriveDisplayTicketId,
  PIPELINE_BOARD_MESSAGE_MAX_LENGTH,
  PIPELINE_BOARD_GRID_MAX_WIDTH,
  PIPELINE_BOARD_PAUSED_MAX,
  PIPELINE_BOARD_COLLAPSED_EPICS_MAX,
} = require('../out/concierge/pipelineBoard');

// BL-956 declared invariants (backlog/active/BL-956-pipeline-board-caption-and-cap-hotfix.yaml):
// 1. The composed board message stays within PIPELINE_BOARD_MESSAGE_MAX_LENGTH
//    for any ticket title length (only the LINK list is budgeted; the body is
//    never trimmed, so an unbounded caption is a new path into the 2026-07-17
//    rejected-send outage).
// 2. Every caption line carries identifying context for its ticket - never a
//    bare id with nothing after it.
// 3. Every cap on this board is visible, never silent: an overflowed list
//    names how many entries it dropped.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.
//
// Non-vacuity proven by hand at authoring time: dropping the caption's
// truncateCaptionDescription call fails invariant 1 on the first long-title
// board; removing the NO_BACKLOG_ENTRY_LABEL fallback fails invariant 2 on
// the first meta-less row; omitting the epics overflow line fails invariant
// 3 on the first over-cap tracker set. All restored.

// Titles skew adversarial BY CONSTRUCTION: long lengths and HTML-escapable
// chars (& < >) are drawn deliberately, not hoped for - escapeHtml expands
// each to 4-5 chars, the exact pressure invariant 1 exists for.
const titleArb = fc
  .record({
    length: fc.oneof(fc.integer({ min: 0, max: 80 }), fc.integer({ min: 1000, max: 5000 })),
    filler: fc.constantFrom('x', '&', '<', 'word '),
  })
  .map(({ length, filler }) => filler.repeat(Math.ceil(length / filler.length)).slice(0, length));

const boardArb = fc.record({
  activeCount: fc.integer({ min: 1, max: 15 }),
  titles: fc.array(titleArb, { minLength: 15, maxLength: 15 }),
  withMeta: fc.array(fc.boolean(), { minLength: 15, maxLength: 15 }),
  epics: fc.array(fc.constantFrom('concerto', 'fugue', undefined), { minLength: 15, maxLength: 15 }),
  plainParkedCount: fc.integer({ min: 0, max: 8 }),
  epicTrackerCount: fc.integer({ min: 0, max: 8 }),
});

function buildBoard(shape) {
  const activeIds = Array.from({ length: shape.activeCount }, (_, i) => `BL-${100 + i}`);
  const ticketMeta = {};
  activeIds.forEach((id, i) => {
    if (shape.withMeta[i]) {
      ticketMeta[id] = { title: shape.titles[i], epic: shape.epics[i], filename: `${id}-x.yaml`, location: 'active' };
    }
  });
  const paused = [
    ...Array.from({ length: shape.plainParkedCount }, (_, i) => ({ id: `BL-${300 + i}`, priority: i })),
    ...Array.from({ length: shape.epicTrackerCount }, (_, i) => ({ id: `BL-${400 + i}`, type: 'epic', epic: `epic-${i}`, priority: i })),
  ];
  paused.forEach((item) => {
    ticketMeta[item.id] = { title: shape.titles[0], epic: item.epic, filename: `${item.id}-x.yaml`, location: 'paused' };
  });
  return { data: computePipelineBoard({}, paused, ticketMeta, { activeIds }), activeIds, ticketMeta };
}

// ── Invariant 1: the composed message always fits the send limit ──────────

test('BL-956 invariant 1: composePipelineBoardHtml stays within the message limit for any title length', () => {
  let hugeTitleBoards = 0;
  fc.assert(
    fc.property(boardArb, (shape) => {
      const { data } = buildBoard(shape);
      const { html } = composePipelineBoardHtml(data, 0, 'https://github.com/x/y');
      assert.ok(
        html.length <= PIPELINE_BOARD_MESSAGE_MAX_LENGTH,
        `composed ${html.length} chars > ${PIPELINE_BOARD_MESSAGE_MAX_LENGTH}`
      );
      if (shape.titles.some((t) => t.length >= 1000)) hugeTitleBoards += 1;
    }),
    { numRuns: 150 }
  );
  assert.ok(hugeTitleBoards >= 30, `only ${hugeTitleBoards} boards carried a >=1000-char title`);
});

// ── Invariant 2: a caption never renders as a bare id ─────────────────────

test('BL-956 invariant 2: every caption line carries non-empty context after its ticket id', () => {
  let metaLessRowsSeen = 0;
  fc.assert(
    fc.property(boardArb, (shape) => {
      const { data } = buildBoard(shape);
      const lines = renderPipelineBoardBody(data).split('\n');
      for (const row of data.rows) {
        const displayId = deriveDisplayTicketId(row.id);
        const caption = lines.find((l) => l.startsWith(`${displayId} `) || l === displayId);
        if (!caption) continue; // dropped by the grid width budget - announced by +N more active (invariant 3)
        const context = caption.slice(displayId.length).trim();
        assert.ok(context.length > 0, `caption for ${row.id} carries nothing after the id: ${JSON.stringify(caption)}`);
        if (row.title === undefined) metaLessRowsSeen += 1;
      }
    }),
    { numRuns: 150 }
  );
  assert.ok(metaLessRowsSeen >= 30, `only ${metaLessRowsSeen} meta-less captions exercised`);
});

// ── Invariant 3: every cap announces what it dropped ──────────────────────

// Independent restatement of the grid's own documented width budget
// (PIPELINE_BOARD_GRID_MAX_WIDTH's comment): 2-char gutter + per column one
// separator + one cell of the widest display id (min 3).
function expectedGridDropped(activeIds) {
  const cellWidth = Math.max(3, ...activeIds.map((id) => deriveDisplayTicketId(id).length));
  const visible = Math.max(0, Math.min(activeIds.length, Math.floor((PIPELINE_BOARD_GRID_MAX_WIDTH - 2) / (1 + cellWidth))));
  return activeIds.length - visible;
}

test('BL-956 invariant 3: grid, parked and collapsed-epic caps each name exactly how many entries they dropped', () => {
  let parkedOverflowSeen = 0;
  let epicsOverflowSeen = 0;
  let gridOverflowSeen = 0;
  fc.assert(
    fc.property(boardArb, (shape) => {
      const { data, activeIds } = buildBoard(shape);
      const text = renderPipelineBoardBody(data);
      const parkedDropped = Math.max(0, shape.plainParkedCount - PIPELINE_BOARD_PAUSED_MAX);
      const epicsDropped = Math.max(0, shape.epicTrackerCount - PIPELINE_BOARD_COLLAPSED_EPICS_MAX);
      const gridDropped = expectedGridDropped(activeIds);
      if (parkedDropped > 0) {
        assert.match(text, new RegExp(`\\+${parkedDropped} more parked`));
        parkedOverflowSeen += 1;
      } else {
        assert.doesNotMatch(text, /more parked/);
      }
      if (epicsDropped > 0) {
        assert.match(text, new RegExp(`\\+${epicsDropped} more epics`));
        epicsOverflowSeen += 1;
      } else {
        assert.doesNotMatch(text, /more epics/);
      }
      if (gridDropped > 0) {
        assert.match(text, new RegExp(`\\+${gridDropped} more active`));
        gridOverflowSeen += 1;
      } else {
        assert.doesNotMatch(text, /more active/);
      }
    }),
    { numRuns: 150 }
  );
  assert.ok(parkedOverflowSeen >= 20, `only ${parkedOverflowSeen} parked overflows exercised`);
  assert.ok(epicsOverflowSeen >= 20, `only ${epicsOverflowSeen} epic overflows exercised`);
  assert.ok(gridOverflowSeen >= 20, `only ${gridOverflowSeen} grid overflows exercised`);
});
