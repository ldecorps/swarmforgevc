const assert = require('node:assert/strict');
const {
  computePipelineBoard,
  renderPipelineBoard,
  renderPipelineBoardBody,
  formatUpdatedAtLabel,
  wrapPipelineBoardHtml,
  deriveTicketSlug,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_SLUG_MAX_LENGTH,
} = require('../out/concierge/pipelineBoard');

// BL-452/BL-455 pipeline-board-01/02: a ticket held by a role becomes a row
// marked only in that role's column; every other column in that row stays
// blank. A paused ticket never becomes a grid row at all (BL-455) - it
// becomes a below-grid parked entry instead.

test('computePipelineBoard: a ticket held by a role is a row in that role column', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-387'], QA: ['BL-413'] }, [], {});
  assert.deepEqual(rows, [
    { id: 'BL-387', column: 'coder', epic: undefined, slug: '' },
    { id: 'BL-413', column: 'QA', epic: undefined, slug: '' },
  ]);
});

test('computePipelineBoard: rows follow pipeline order (specifier..coordinator), not object key order, within an epic group', () => {
  const { rows } = computePipelineBoard({ QA: ['BL-2'], coder: ['BL-1'] }, [], {});
  assert.deepEqual(
    rows.map((r) => r.id),
    ['BL-1', 'BL-2']
  );
});

test('computePipelineBoard: a batch role holding several tickets gets one row per ticket', () => {
  const { rows } = computePipelineBoard({ cleaner: ['BL-100', 'BL-101'] }, [], {});
  assert.deepEqual(rows, [
    { id: 'BL-100', column: 'cleaner', epic: undefined, slug: '' },
    { id: 'BL-101', column: 'cleaner', epic: undefined, slug: '' },
  ]);
});

test('computePipelineBoard: no role-held tickets renders no grid rows', () => {
  assert.deepEqual(computePipelineBoard({}, [], {}).rows, []);
});

// BL-455 pipeline-board-epic-01: rows sharing an epic sort together, and
// no-epic rows sort together too (as one bucket) - always LAST, deterministic
// regardless of iteration order.

test('computePipelineBoard: rows sharing an epic are grouped together, no-epic rows grouped together and last', () => {
  const { rows } = computePipelineBoard(
    { coder: ['BL-1'], architect: ['BL-2'], QA: ['BL-3'], hardender: ['BL-4'] },
    [],
    {
      'BL-1': { epic: 'Beta', title: 'first' },
      'BL-2': { epic: 'Alpha', title: 'second' },
      'BL-3': { epic: 'Alpha', title: 'third' },
      'BL-4': { title: 'fourth' },
    }
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['BL-2', 'BL-3', 'BL-1', 'BL-4'],
    'expected epic Alpha (BL-2, BL-3) before epic Beta (BL-1), no-epic (BL-4) last'
  );
});

test('computePipelineBoard: grouping is a stable sort - ties within one epic keep role order', () => {
  const { rows } = computePipelineBoard({ documenter: ['BL-9'], coder: ['BL-8'] }, [], {
    'BL-9': { epic: 'Same' },
    'BL-8': { epic: 'Same' },
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    ['BL-8', 'BL-9'],
    'expected coder (pipeline-earlier) before documenter even though BL-9 was inserted first'
  );
});

// BL-455 pipeline-board-epic-02/03: parked/awaiting-approval tickets never
// become grid rows - they become below-grid parked entries instead.

test('computePipelineBoard: a paused ticket never becomes a grid row', () => {
  const { rows, parked } = computePipelineBoard({}, [{ id: 'BL-436' }], {});
  assert.deepEqual(rows, []);
  assert.equal(parked.length, 1);
});

test('computePipelineBoard: a paused ticket with no pending approval is "parked"', () => {
  const { parked } = computePipelineBoard({}, [{ id: 'BL-436' }], {});
  assert.deepEqual(parked, [{ id: 'BL-436', slug: '', status: 'parked' }]);
});

test('computePipelineBoard: a paused ticket with humanApproval "approved" is still "parked"', () => {
  const { parked } = computePipelineBoard({}, [{ id: 'BL-436', humanApproval: 'approved' }], {});
  assert.deepEqual(parked, [{ id: 'BL-436', slug: '', status: 'parked' }]);
});

test('computePipelineBoard: a paused ticket awaiting human approval is "awaiting-approval"', () => {
  const { parked } = computePipelineBoard({}, [{ id: 'BL-449', humanApproval: 'pending' }], {});
  assert.deepEqual(parked, [{ id: 'BL-449', slug: '', status: 'awaiting-approval' }]);
});

test('computePipelineBoard: the parked list is sorted by id, deterministic regardless of input order', () => {
  const { parked } = computePipelineBoard({}, [{ id: 'BL-9' }, { id: 'BL-2' }], {});
  assert.deepEqual(
    parked.map((p) => p.id),
    ['BL-2', 'BL-9']
  );
});

test('computePipelineBoard: every ticket lands in exactly one place - role-held in rows, paused in parked, never both', () => {
  const { rows, parked } = computePipelineBoard({ coder: ['BL-1'] }, [{ id: 'BL-2' }], {});
  assert.deepEqual(
    rows.map((r) => r.id),
    ['BL-1']
  );
  assert.deepEqual(
    parked.map((p) => p.id),
    ['BL-2']
  );
});

test('computePipelineBoard: no active or paused tickets renders an empty board', () => {
  assert.deepEqual(computePipelineBoard({}, [], {}), { rows: [], parked: [] });
});

// BL-455 pipeline-board-epic-04: a short, single-line, delimiter-safe slug
// derived from the ticket's title - never the raw title verbatim.

test('deriveTicketSlug: a short title is used as-is', () => {
  assert.equal(deriveTicketSlug('fix the pipeline board'), 'fix the pipeline board');
});

test('deriveTicketSlug: no title is an empty slug', () => {
  assert.equal(deriveTicketSlug(undefined), '');
});

test('deriveTicketSlug: newlines are stripped to a single line', () => {
  assert.equal(deriveTicketSlug('first line\nsecond line'), 'first line second line');
});

test('deriveTicketSlug: a long title is truncated to the bound, never returned verbatim', () => {
  const longTitle = 'a'.repeat(PIPELINE_BOARD_SLUG_MAX_LENGTH + 20);
  const slug = deriveTicketSlug(longTitle);
  assert.ok(slug.length <= PIPELINE_BOARD_SLUG_MAX_LENGTH);
  assert.notEqual(slug, longTitle);
});

// BL-462 pipeline-board-refine-01: the slug bound widened 24 -> 40 ("longer
// slug, same line" - the human's own answer to the specifier's clarifying
// question). A title that would have overflowed the OLD bound but fits the
// new one now renders in full, still on a single line.
const PREVIOUS_SLUG_MAX_LENGTH = 24;

test('deriveTicketSlug: a title longer than the previous slug limit but within the wider limit now fits in full', () => {
  const title = 'a'.repeat(PREVIOUS_SLUG_MAX_LENGTH + 10);
  assert.ok(title.length > PREVIOUS_SLUG_MAX_LENGTH && title.length <= PIPELINE_BOARD_SLUG_MAX_LENGTH);
  const slug = deriveTicketSlug(title);
  assert.equal(slug, title, 'expected the full title to fit under the widened bound, not truncated');
  assert.ok(!slug.includes('\n'), 'expected a single line');
});

test('computePipelineBoard: a role-held ticket with a title gets its derived slug', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-1'] }, [], { 'BL-1': { title: 'fix the widget' } });
  assert.equal(rows[0].slug, 'fix the widget');
});

test('computePipelineBoard: a paused ticket with a title gets its derived slug', () => {
  const { parked } = computePipelineBoard({}, [{ id: 'BL-2' }], { 'BL-2': { title: 'clean up docs' } });
  assert.equal(parked[0].slug, 'clean up docs');
});

// BL-452/BL-455 pipeline-board-01: the header names every pipeline role
// column (parked/awaiting-approval are no longer grid columns); each data
// row marks exactly one role column, every other role column stays blank.

test('renderPipelineBoardBody: header lists every pipeline role column, plus TICKET and SLUG', () => {
  const header = renderPipelineBoardBody({ rows: [], parked: [] });
  for (const column of PIPELINE_BOARD_COLUMN_ORDER) {
    assert.ok(header.length > 0, `expected the header to render for role ${column}`);
  }
  assert.equal(renderPipelineBoardBody({ rows: [], parked: [] }), header);
});

test('renderPipelineBoardBody: an empty board is just the header line', () => {
  const text = renderPipelineBoardBody({ rows: [], parked: [] });
  assert.equal(text.split('\n').length, 1);
});

test('renderPipelineBoardBody: a row is marked only in its own column', () => {
  // A non-empty slug ('x') guarantees the slug cell survives whitespace-split
  // parsing below as its own token - an empty slug collapses into the
  // surrounding padding and would silently misalign this test's column check.
  const text = renderPipelineBoardBody({ rows: [{ id: 'BL-387', column: 'coder', slug: 'x' }], parked: [] });
  const lines = text.split('\n');
  // line 0: header, line 1: epic heading ("-- (no epic) --"), line 2: data row.
  assert.equal(lines.length, 3);
  const header = lines[0].trim().split(/\s+/);
  const row = lines[2].trim().split(/\s+/);
  const headerRoleCols = header.slice(2); // drop TICKET, SLUG
  const rowRoleCols = row.slice(2); // drop id, slug
  assert.equal(rowRoleCols.length, headerRoleCols.length);
  const coderIndex = headerRoleCols.indexOf('CO');
  rowRoleCols.forEach((cell, i) => {
    assert.equal(cell, i === coderIndex ? 'X' : '.');
  });
});

test('renderPipelineBoardBody: two tickets in different columns each mark only their own', () => {
  const text = renderPipelineBoardBody({
    rows: [
      { id: 'BL-387', column: 'coder', slug: '' },
      { id: 'BL-413', column: 'QA', slug: '' },
    ],
    parked: [],
  });
  const lines = text.split('\n');
  assert.ok(lines.some((l) => l.startsWith('BL-387')));
  assert.ok(lines.some((l) => l.startsWith('BL-413')));
});

test('renderPipelineBoardBody: ticket-id column widens to fit the longest id without breaking alignment', () => {
  const text = renderPipelineBoardBody({
    rows: [
      { id: 'BL-9', column: 'coder', slug: '' },
      { id: 'BL-123456', column: 'QA', slug: '' },
    ],
    parked: [],
  });
  const idWidth = 'BL-123456'.length;
  const dataLines = text.split('\n').filter((l) => l.startsWith('BL-'));
  for (const line of dataLines) {
    assert.equal(line[idWidth], ' ', `expected a column boundary at ${idWidth} in "${line}"`);
  }
});

test('renderPipelineBoardBody: rendering is a pure function of its data - same input, same text', () => {
  const data = { rows: [{ id: 'BL-1', column: 'coder', slug: '' }], parked: [] };
  assert.equal(renderPipelineBoardBody(data), renderPipelineBoardBody(data));
});

// BL-455 pipeline-board-epic-01/05: rows are grouped by epic under a
// heading; a no-epic bucket is grouped together too.

test('renderPipelineBoardBody: rows sharing an epic render under one heading', () => {
  const text = renderPipelineBoardBody({
    rows: [
      { id: 'BL-1', column: 'coder', epic: 'Alpha', slug: '' },
      { id: 'BL-2', column: 'QA', epic: 'Alpha', slug: '' },
    ],
    parked: [],
  });
  const lines = text.split('\n');
  assert.equal(lines.filter((l) => l.includes('Alpha')).length, 1, 'expected exactly one Alpha heading');
  const headingIndex = lines.findIndex((l) => l.includes('Alpha'));
  assert.ok(lines[headingIndex + 1].startsWith('BL-1'));
  assert.ok(lines[headingIndex + 2].startsWith('BL-2'));
});

test('renderPipelineBoardBody: a no-epic row renders under its own heading, distinct from a named epic', () => {
  const text = renderPipelineBoardBody({
    rows: [
      { id: 'BL-1', column: 'coder', epic: 'Alpha', slug: '' },
      { id: 'BL-2', column: 'QA', slug: '' },
    ],
    parked: [],
  });
  const lines = text.split('\n');
  const alphaIndex = lines.findIndex((l) => l.includes('Alpha'));
  const noEpicIndex = lines.findIndex((l) => l.startsWith('--') && !l.includes('Alpha'));
  assert.ok(alphaIndex >= 0 && noEpicIndex > alphaIndex);
  assert.ok(lines[noEpicIndex + 1].startsWith('BL-2'));
});

// BL-455 pipeline-board-epic-02/03: parked/awaiting-approval tickets render
// in a below-grid list, never as stage-grid rows.

test('renderPipelineBoardBody: an empty parked list renders no below-grid section', () => {
  const text = renderPipelineBoardBody({ rows: [{ id: 'BL-1', column: 'coder', slug: '' }], parked: [] });
  assert.ok(!text.includes('PARKED'));
});

test('renderPipelineBoardBody: parked entries render below the grid, not as grid rows', () => {
  const text = renderPipelineBoardBody({
    rows: [{ id: 'BL-1', column: 'coder', slug: '' }],
    parked: [{ id: 'BL-436', slug: 'stalled work', status: 'parked' }],
  });
  const lines = text.split('\n');
  const parkedHeaderIndex = lines.findIndex((l) => l.trim() === 'PARKED:');
  assert.ok(parkedHeaderIndex > 0);
  const gridLines = lines.slice(0, parkedHeaderIndex);
  const belowLines = lines.slice(parkedHeaderIndex);
  assert.ok(!gridLines.some((l) => l.trim().split(/\s+/)[0] === 'BL-436'), 'expected BL-436 to be absent from the grid');
  assert.ok(belowLines.some((l) => l.includes('BL-436') && l.includes('stalled work')));
});

test('renderPipelineBoardBody: an awaiting-approval entry is distinguishable from a plain parked one below the grid', () => {
  const text = renderPipelineBoardBody({
    rows: [],
    parked: [
      { id: 'BL-436', slug: '', status: 'parked' },
      { id: 'BL-449', slug: '', status: 'awaiting-approval' },
    ],
  });
  const lines = text.split('\n');
  const parkedLine = lines.find((l) => l.includes('BL-436'));
  const awaitingLine = lines.find((l) => l.includes('BL-449'));
  assert.notEqual(parkedLine.trim().split(/\s+/)[0], awaitingLine.trim().split(/\s+/)[0]);
});

// BL-452: the board posts as a Telegram HTML <pre> block so the grid stays
// monospace/aligned; only the handful of HTML-significant characters ever
// need escaping (ticket ids and column glyphs never carry them in
// practice, but the wrap must not corrupt the markup if they ever did).

test('wrapPipelineBoardHtml: wraps the grid text in a <pre> block', () => {
  assert.equal(wrapPipelineBoardHtml('TICKET SP\nBL-1    X'), '<pre>TICKET SP\nBL-1    X</pre>');
});

test('wrapPipelineBoardHtml: escapes HTML-significant characters', () => {
  assert.equal(wrapPipelineBoardHtml('a & b < c > d'), '<pre>a &amp; b &lt; c &gt; d</pre>');
});

// BL-462 pipeline-board-refine-03: an "updated at" footer, fed a pure
// formatter over an injected instant - never a bare new Date()/Date.now()
// in the renderer or its formatter.

test('formatUpdatedAtLabel: formats an injected epoch-ms as "Mon DD HH:MM" in UTC', () => {
  const epochMs = Date.UTC(2026, 6, 16, 20, 5); // Jul 16 2026, 20:05 UTC
  assert.equal(formatUpdatedAtLabel(epochMs), 'Jul 16 20:05');
});

test('formatUpdatedAtLabel: pads single-digit day/hour/minute', () => {
  const epochMs = Date.UTC(2026, 0, 5, 3, 7); // Jan 5 2026, 03:07 UTC
  assert.equal(formatUpdatedAtLabel(epochMs), 'Jan 05 03:07');
});

test('formatUpdatedAtLabel: is a pure function of its input - same epoch, same label', () => {
  const epochMs = 1752696300000;
  assert.equal(formatUpdatedAtLabel(epochMs), formatUpdatedAtLabel(epochMs));
});

test('renderPipelineBoard: appends an "updated at" footer showing the injected instant', () => {
  const data = { rows: [{ id: 'BL-1', column: 'coder', slug: '' }], parked: [] };
  const epochMs = Date.UTC(2026, 6, 16, 20, 5);
  const text = renderPipelineBoard(data, epochMs);
  const lines = text.split('\n');
  assert.equal(lines[lines.length - 1], `updated at ${formatUpdatedAtLabel(epochMs)}`);
});

test('renderPipelineBoard: the footer is appended after the body - renderPipelineBoardBody is unaffected', () => {
  const data = { rows: [{ id: 'BL-1', column: 'coder', slug: '' }], parked: [] };
  const withFooter = renderPipelineBoard(data, 1234567890);
  const body = renderPipelineBoardBody(data);
  assert.ok(withFooter.startsWith(body), 'expected the body to render identically, footer only appended after it');
  assert.notEqual(withFooter, body);
});

test('renderPipelineBoard: two different lastChangeMs values a minute apart produce two different footers over the identical body', () => {
  const data = { rows: [], parked: [] };
  const first = renderPipelineBoard(data, Date.UTC(2026, 6, 16, 20, 5));
  const second = renderPipelineBoard(data, Date.UTC(2026, 6, 16, 20, 6));
  assert.notEqual(first, second);
  assert.equal(renderPipelineBoardBody(data), renderPipelineBoardBody(data), 'expected the content-only body to stay identical regardless of the clock');
});
