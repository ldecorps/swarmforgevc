const assert = require('node:assert/strict');
const {
  renderPipelineBoardBody,
  renderPipelineBoardGridOnly,
  PIPELINE_BOARD_GRID_MAX_WIDTH,
  PIPELINE_BOARD_GRID_MAX_ROWS,
  PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX,
} = require('../out/concierge/pipelineBoard');

// BL-979: the axis pivot. BL-585 gave each active ticket its own COLUMN with
// the stages as shared rows, so the board grew sideways with every promotion
// - and on a phone width is the scarce axis while vertical growth is cheap.
// Tickets are now ROWS and the eight stages are shared COLUMNS flowing left
// to right. Still ONE matrix with a single shared header (NOT a return to
// BL-455's per-ticket pivoted blocks), marks still X / . .
//
// Expected lines are BUILT from the layout rule rather than hand-typed as
// NBSP runs, but the comparison stays byte-for-byte - a whitespace-normalized
// assertion would pass while the phone render is broken (BL-585's own
// explicit warning, kept).

const NBSP = '\u00a0';
const STAGE_GLYPHS = ['NS', 'SP', 'CO', 'CL', 'AR', 'HD', 'DC', 'QA'];
const STAGE_CELL_WIDTH = 2;

function gridLine(gutterText, gutterWidth, cells) {
  return (
    gutterText.padStart(gutterWidth, NBSP) +
    cells.map((c) => NBSP + c.padStart(STAGE_CELL_WIDTH, NBSP)).join('')
  );
}

const headerLine = (gutterWidth) => gridLine('', gutterWidth, STAGE_GLYPHS);

// One "X" in the held stage, "." in the other seven.
function ticketRow(displayId, gutterWidth, heldGlyph) {
  return gridLine(displayId, gutterWidth, STAGE_GLYPHS.map((g) => (g === heldGlyph ? 'X' : '.')));
}

const bodyLines = (data) => renderPipelineBoardBody({ parked: [], ...data }).split('\n');

// ── scenario 01: one row per ticket, one shared stage header ─────────────

test('BL-979 sc01: the header lists the eight stage glyphs left to right, once', () => {
  const lines = bodyLines({ rows: [{ id: 'BL-948', column: 'coder', slug: '' }] });
  assert.equal(lines[0], headerLine(3));
});

test('BL-979 sc01: each active ticket occupies exactly one row labelled with its display id', () => {
  const lines = bodyLines({
    rows: [
      { id: 'BL-948', column: 'coder', slug: '' },
      { id: 'BL-979', column: 'QA', slug: '' },
    ],
  });
  assert.equal(lines[1], ticketRow('948', 3, 'CO'));
  assert.equal(lines[2], ticketRow('979', 3, 'QA'));
  // Count GRID lines only - the caption line for the same ticket also
  // begins with its display id, so a bare startsWith over the whole body
  // would double-count and pass for the wrong reason.
  const gridRows = lines.slice(0, lines.indexOf('')).slice(1);
  assert.deepEqual(gridRows, [ticketRow('948', 3, 'CO'), ticketRow('979', 3, 'QA')], 'exactly one grid row per ticket');
});

test('BL-979 sc01: a row marks X in its held stage column and "." in every other', () => {
  for (const [column, glyph] of [
    ['not-started', 'NS'],
    ['specifier', 'SP'],
    ['coder', 'CO'],
    ['cleaner', 'CL'],
    ['architect', 'AR'],
    ['hardender', 'HD'],
    ['documenter', 'DC'],
    ['QA', 'QA'],
  ]) {
    const lines = bodyLines({ rows: [{ id: 'BL-948', column, slug: '' }] });
    assert.equal(lines[1], ticketRow('948', 3, glyph), `stage ${column}`);
  }
});

test('BL-979 sc01: there is ONE matrix - the stage header appears exactly once, not per ticket', () => {
  const lines = bodyLines({
    rows: [
      { id: 'BL-1', column: 'coder', slug: '' },
      { id: 'BL-2', column: 'QA', slug: '' },
      { id: 'BL-3', column: 'specifier', slug: '' },
    ],
  });
  assert.equal(lines.filter((l) => l === headerLine(3)).length, 1);
});

// ── scenario 02: epic separators and a blank line before every summary ───

test('BL-979 sc02: each epic group opens with a "-- <epic-slug> --" separator', () => {
  const lines = bodyLines({
    rows: [
      { id: 'BL-948', column: 'coder', epic: 'code-quality-gates', slug: '', title: 'alpha' },
      { id: 'BL-979', column: 'QA', epic: 'pipeline-board', slug: '', title: 'beta' },
    ],
  });
  assert.ok(lines.includes('-- code-quality-gates --'), lines.join('\n'));
  assert.ok(lines.includes('-- pipeline-board --'), lines.join('\n'));
  assert.ok(
    lines.indexOf('-- code-quality-gates --') < lines.indexOf('948 alpha'),
    'the separator opens its group'
  );
});

test('BL-979 sc02: every ticket summary is preceded by a blank line', () => {
  const lines = bodyLines({
    rows: [
      { id: 'BL-948', column: 'coder', epic: 'code-quality-gates', slug: '', title: 'alpha' },
      { id: 'BL-949', column: 'QA', epic: 'code-quality-gates', slug: '', title: 'beta' },
      { id: 'BL-979', column: 'QA', epic: 'pipeline-board', slug: '', title: 'gamma' },
    ],
  });
  for (const summary of ['948 alpha', '949 beta', '979 gamma']) {
    const i = lines.indexOf(summary);
    assert.ok(i > 0, `summary "${summary}" present`);
    assert.equal(lines[i - 1], '', `a blank line precedes "${summary}"`);
  }
});

test('BL-979 sc02: a summary line is the display id followed by the ticket title', () => {
  const lines = bodyLines({
    rows: [{ id: 'BL-948', column: 'coder', epic: 'code-quality-gates', slug: 'sock', title: 'socket fixture roots' }],
  });
  assert.ok(lines.includes('948 socket fixture roots'));
});

// ── scenario 03: the epic-less bucket ────────────────────────────────────

test('BL-979 sc03: mixed membership ends with a "-- (no epic) --" group holding those tickets', () => {
  const lines = bodyLines({
    rows: [
      { id: 'BL-948', column: 'coder', epic: 'code-quality-gates', slug: '', title: 'alpha' },
      { id: 'BL-999', column: 'QA', slug: '', title: 'loose' },
    ],
  });
  const sep = lines.indexOf('-- (no epic) --');
  assert.ok(sep > lines.indexOf('-- code-quality-gates --'), 'the (no epic) group comes last');
  assert.ok(lines.indexOf('999 loose') > sep, 'the epic-less ticket sits under it');
});

test('BL-979 sc03: a wholly epic-less board emits no separator line at all', () => {
  const lines = bodyLines({
    rows: [
      { id: 'BL-1', column: 'coder', slug: '', title: 'alpha' },
      { id: 'BL-2', column: 'QA', slug: '', title: 'beta' },
    ],
  });
  assert.deepEqual(lines.filter((l) => l.startsWith('-- ')), [], 'no separator on a wholly epic-less board');
  assert.ok(lines.includes('1 alpha') || lines.includes('BL-1 alpha'), lines.join('\n'));
});

// ── scenario 04: the row budget drops visibly, never silently ────────────

test('BL-979 sc04: rows beyond the budget are the tail-drop of the same order, announced by "+N more active"', () => {
  const rows = Array.from({ length: PIPELINE_BOARD_GRID_MAX_ROWS + 3 }, (_, i) => ({
    id: `BL-${100 + i}`,
    column: 'coder',
    epic: 'code-quality-gates',
    slug: '',
    title: `t${i}`,
  }));
  const lines = bodyLines({ rows });
  const visibleIds = rows.slice(0, PIPELINE_BOARD_GRID_MAX_ROWS).map((r) => r.id.replace('BL-', ''));
  const droppedIds = rows.slice(PIPELINE_BOARD_GRID_MAX_ROWS).map((r) => r.id.replace('BL-', ''));
  for (const id of visibleIds) {
    assert.ok(lines.some((l) => l.trimStart().startsWith(id)), `visible row ${id}`);
  }
  for (const id of droppedIds) {
    assert.ok(!lines.some((l) => l.trimStart().startsWith(`${id}${NBSP}`)), `dropped row ${id} has no grid line`);
  }
  assert.ok(lines.includes('+3 more active'), lines.join('\n'));
});

test('BL-979 sc04 / invariant 1: the caption list covers exactly the visible rows, never more and never fewer', () => {
  const rows = Array.from({ length: PIPELINE_BOARD_GRID_MAX_ROWS + 5 }, (_, i) => ({
    id: `BL-${200 + i}`,
    column: 'coder',
    epic: 'code-quality-gates',
    slug: '',
    title: `title ${i}`,
  }));
  const lines = bodyLines({ rows });
  const summaries = lines.filter((l) => /^\d+ title \d+$/.test(l));
  assert.equal(summaries.length, PIPELINE_BOARD_GRID_MAX_ROWS, 'one caption per visible row, no more');
  assert.deepEqual(
    summaries,
    rows.slice(0, PIPELINE_BOARD_GRID_MAX_ROWS).map((r) => `${r.id.replace('BL-', '')} ${r.title}`)
  );
});

// ── scenario 05 / invariant 2: width is a property of the stage set ──────

test('BL-979 sc05 / invariant 2: 3-, 4- and 5-digit ids never drop a row, and stay inside the width budget', () => {
  for (const [idWidth, prefix] of [[3, 100], [4, 1000], [5, 10000]]) {
    const rows = Array.from({ length: PIPELINE_BOARD_GRID_MAX_ROWS }, (_, i) => ({
      id: `BL-${prefix + i}`,
      column: 'coder',
      slug: '',
    }));
    const text = renderPipelineBoardGridOnly({ rows, parked: [] });
    const lines = text.split('\n');
    assert.ok(!lines.some((l) => l.includes('more active')), `no row dropped at ${idWidth}-digit ids`);
    const gridLines = lines.filter((l) => l.includes(NBSP));
    const widest = Math.max(...gridLines.map((l) => l.length));
    assert.equal(widest, idWidth + STAGE_GLYPHS.length * (1 + STAGE_CELL_WIDTH), `${idWidth}-digit grid width`);
    assert.ok(widest <= PIPELINE_BOARD_GRID_MAX_WIDTH, `${idWidth}-digit ids fit the ${PIPELINE_BOARD_GRID_MAX_WIDTH}-char budget`);
  }
});

// ── scenario 06: caption content is unchanged by the pivot (BL-956) ──────

test('BL-979 sc06: an over-long title is still ellipsis-truncated to the caption budget', () => {
  const long = 'x'.repeat(PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX + 20);
  const lines = bodyLines({ rows: [{ id: 'BL-948', column: 'coder', slug: 's', title: long }] });
  const summary = lines.find((l) => l.startsWith('948 '));
  assert.equal(summary, `948 ${'x'.repeat(PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX - 1)}…`);
});

test('BL-979 sc06: a ticket with no backlog entry still captions "(no backlog entry)"', () => {
  const lines = bodyLines({ rows: [{ id: 'BL-948', column: 'coder', slug: '' }] });
  assert.ok(lines.includes('948 (no backlog entry)'), lines.join('\n'));
});

// ── regression: the empty board is unchanged ─────────────────────────────

test('BL-979: an empty active set still renders the bare no-active-tickets placeholder', () => {
  assert.equal(renderPipelineBoardBody({ rows: [], parked: [] }).trim(), '(no active tickets)');
});
