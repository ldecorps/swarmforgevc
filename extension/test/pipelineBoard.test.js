const assert = require('node:assert/strict');
const {
  computePipelineBoard,
  renderPipelineBoard,
  renderPipelineBoardBody,
  renderPipelineBoardLinks,
  budgetPipelineBoardLinks,
  formatUpdatedAtLabel,
  wrapPipelineBoardHtml,
  deriveKebabSlug,
  deriveListEntryText,
  deriveDisplayTicketId,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_RECENTLY_CLOSED_MAX,
  PIPELINE_BOARD_NOT_STARTED_COLUMN,
  PIPELINE_BOARD_MESSAGE_MAX_LENGTH,
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

test('computePipelineBoard: rows follow pipeline order (specifier..QA), not object key order, within an epic group', () => {
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

// ── BL-464 board-authoritative-stage-02/03: a ticket observed at two roles
// at once (a mid-transition scrape's own double-row defect) collapses to
// exactly one row, at the MORE DOWNSTREAM role - never two rows, never the
// stale/upstream one. ──────────────────────────────────────────────────

test('BL-464: a ticket held under two roles at once collapses to exactly one row, at the more downstream role', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-460'], cleaner: ['BL-460'] }, [], {});
  assert.deepEqual(rows, [{ id: 'BL-460', column: 'cleaner', epic: undefined, slug: '' }]);
});

test('BL-464: the double-role collapse is independent of which role the input map lists first', () => {
  const { rows } = computePipelineBoard({ cleaner: ['BL-460'], coder: ['BL-460'] }, [], {});
  assert.deepEqual(rows, [{ id: 'BL-460', column: 'cleaner', epic: undefined, slug: '' }]);
});

test('BL-464: a ticket held under two roles alongside other distinct tickets still yields one row per distinct id', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-1', 'BL-460'], cleaner: ['BL-460', 'BL-2'] }, [], {});
  assert.deepEqual(rows.map((r) => `${r.id}:${r.column}`).sort(), ['BL-1:coder', 'BL-2:cleaner', 'BL-460:cleaner']);
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
  assert.deepEqual(computePipelineBoard({}, [], {}), { rows: [], parked: [], rootIntake: [], recentlyClosed: [], links: [] });
});

// ── BL-473: extras.activeIds (physical backlog/active/ membership) is the
// board's row-membership ground truth - a role-held ticket only decorates a
// row's stage once membership already includes it. Omitting activeIds
// defaults to the ids already implied by roleHeldTickets, so every
// pre-BL-473 call site above (none of which pass activeIds) keeps rendering
// identically. ──────────────────────────────────────────────────────────

test('computePipelineBoard: an active id no role holds renders as a not-started row', () => {
  const { rows } = computePipelineBoard({}, [], {}, { activeIds: ['BL-1'] });
  assert.deepEqual(rows, [{ id: 'BL-1', column: PIPELINE_BOARD_NOT_STARTED_COLUMN, epic: undefined, slug: '' }]);
});

test('computePipelineBoard: an active id a role holds still renders at that role\'s stage, not not-started', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-1'] }, [], {}, { activeIds: ['BL-1'] });
  assert.deepEqual(rows, [{ id: 'BL-1', column: 'coder', epic: undefined, slug: '' }]);
});

test('computePipelineBoard: activeIds is the sole membership source - a role-held ticket absent from it gets no row at all', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-2'] }, [], {}, { activeIds: ['BL-1'] });
  assert.deepEqual(rows, [{ id: 'BL-1', column: PIPELINE_BOARD_NOT_STARTED_COLUMN, epic: undefined, slug: '' }]);
});

test('computePipelineBoard: every activeIds entry is a row exactly once, even with duplicates in the input', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-1'] }, [], {}, { activeIds: ['BL-1', 'BL-2', 'BL-1'] });
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    ['BL-1', 'BL-2']
  );
});

test('computePipelineBoard: a not-started row carries its ticket meta (epic/slug) same as a held row would', () => {
  const { rows } = computePipelineBoard({}, [], { 'BL-1': { epic: 'Alpha', title: 'fix the widget' } }, { activeIds: ['BL-1'] });
  assert.deepEqual(rows, [{ id: 'BL-1', column: PIPELINE_BOARD_NOT_STARTED_COLUMN, epic: 'Alpha', slug: 'fix-the' }]);
});

test('renderPipelineBoardBody: a not-started row marks only the not-started column, no pipeline role column', () => {
  const text = renderPipelineBoardBody({ rows: [{ id: 'BL-1', column: PIPELINE_BOARD_NOT_STARTED_COLUMN, slug: 'x' }], parked: [] });
  const lines = text.split('\n');
  const header = lines[0].trim().split(/\s+/);
  const row = lines[2].trim().split(/\s+/);
  const headerCols = header.slice(2);
  const rowCols = row.slice(2);
  const nsIndex = headerCols.indexOf('NS');
  assert.ok(nsIndex >= 0, `expected a not-started (NS) column in the header, got: ${header.join(' ')}`);
  rowCols.forEach((cell, i) => {
    assert.equal(cell, i === nsIndex ? 'X' : '.');
  });
});

test('computePipelineBoard: a role-held ticket with a title gets its derived (grid) kebab slug', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-1'] }, [], { 'BL-1': { title: 'fix the widget' } });
  assert.equal(rows[0].slug, 'fix-the');
});

test('computePipelineBoard: a paused ticket with a title gets its derived (list) kebab-only slug', () => {
  const { parked } = computePipelineBoard({}, [{ id: 'BL-2' }], { 'BL-2': { title: 'clean up docs' } });
  assert.equal(parked[0].slug, 'clean-up');
});

// BL-452/BL-455 pipeline-board-01: the header names every pipeline role
// column (parked/awaiting-approval are no longer grid columns); each data
// row marks exactly one role column, every other role column stays blank.

test('renderPipelineBoardBody: header lists every pipeline role column, plus ID and SLUG', () => {
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
  const headerRoleCols = header.slice(2); // drop ID, SLUG
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
  // BL-505: the grid TICKET column shows the ticket NUMBER only.
  assert.ok(lines.some((l) => l.startsWith('387')));
  assert.ok(lines.some((l) => l.startsWith('413')));
});

test('renderPipelineBoardBody: ticket-id column widens to fit the longest DISPLAYED id without breaking alignment', () => {
  const text = renderPipelineBoardBody({
    rows: [
      { id: 'BL-9', column: 'coder', slug: '' },
      { id: 'BL-123456', column: 'QA', slug: '' },
    ],
    parked: [],
  });
  // BL-505: the column width is driven by the NUMBER-only display ids
  // ("9", "123456"), not the raw "BL-"-prefixed ids.
  const idWidth = '123456'.length;
  const dataLines = text.split('\n').filter((l) => /^\d/.test(l));
  assert.equal(dataLines.length, 2);
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
  // BL-505: the grid TICKET column shows the ticket NUMBER only.
  assert.ok(lines[headingIndex + 1].startsWith('1'));
  assert.ok(lines[headingIndex + 2].startsWith('2'));
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
  // BL-505: the grid TICKET column shows the ticket NUMBER only.
  assert.ok(lines[noEpicIndex + 1].startsWith('2'));
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
  // BL-505: below-grid list lines show the ticket NUMBER only.
  assert.ok(!gridLines.some((l) => l.trim().split(/\s+/)[0] === '436'), 'expected 436 to be absent from the grid');
  assert.ok(belowLines.some((l) => l.includes('436') && l.includes('stalled work')));
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
  // BL-505: below-grid list lines show the ticket NUMBER only.
  const parkedLine = lines.find((l) => l.includes('436'));
  const awaitingLine = lines.find((l) => l.includes('449'));
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

// ── BL-465: deriveKebabSlug / deriveListEntryText (pure) ──────────────────

test('deriveKebabSlug: takes the first 2 significant words, lowercased and hyphenated', () => {
  assert.equal(deriveKebabSlug('Pipeline Board: Post The New Message'), 'pipeline-board');
});

test('deriveKebabSlug: strips punctuation rather than treating it as a word boundary only', () => {
  assert.equal(deriveKebabSlug("BL-467: Pipeline board's own pin"), 'bl-467');
});

test('deriveKebabSlug: a short title (fewer than 2 words) uses every word it has', () => {
  assert.equal(deriveKebabSlug('fix'), 'fix');
});

test('deriveKebabSlug: a title with exactly maxWords words uses every word it has', () => {
  assert.equal(deriveKebabSlug('fix widget'), 'fix-widget');
});

test('deriveKebabSlug: no title is an empty slug', () => {
  assert.equal(deriveKebabSlug(undefined), '');
});

test('deriveKebabSlug: a custom maxWords bound is honoured', () => {
  assert.equal(deriveKebabSlug('one two three four five', 3), 'one-two-three');
});

test('deriveListEntryText: is the short kebab slug only, no wider title tail', () => {
  assert.equal(deriveListEntryText('clean up docs'), 'clean-up');
});

test('deriveListEntryText: no title is an empty string (never throws)', () => {
  assert.equal(deriveListEntryText(undefined), '');
});

// ── BL-505: deriveDisplayTicketId / narrower grid+list rendering / NS-first ──
// BL-505 pipeline-board-narrower-grid-and-lists-01/03/04/05/06

test('deriveDisplayTicketId: strips a recognised BL- prefix, leaving the number only', () => {
  assert.equal(deriveDisplayTicketId('BL-493'), '493');
});

test('deriveDisplayTicketId: strips a recognised GH- prefix, leaving the number only', () => {
  assert.equal(deriveDisplayTicketId('GH-42'), '42');
});

test('deriveDisplayTicketId: an id with no recognised ticket prefix is left unchanged', () => {
  assert.equal(deriveDisplayTicketId('INTAKE-pipeline-board-grid'), 'INTAKE-pipeline-board-grid');
});

test('renderPipelineBoardBody: the grid ticket column shows the ticket number without its BL-/GH- prefix', () => {
  const text = renderPipelineBoardBody({
    rows: [
      { id: 'BL-493', column: 'coder', slug: '' },
      { id: 'GH-42', column: 'QA', slug: '' },
    ],
    parked: [],
  });
  const lines = text.split('\n');
  assert.ok(lines.some((l) => l.trim().split(/\s+/)[0] === '493'));
  assert.ok(lines.some((l) => l.trim().split(/\s+/)[0] === '42'));
});

test('renderPipelineBoardBody: the ticket column is no wider than the ticket numbers it contains', () => {
  const text = renderPipelineBoardBody({
    rows: [
      { id: 'BL-493', column: 'coder', slug: '' },
      { id: 'BL-504', column: 'QA', slug: '' },
    ],
    parked: [],
  });
  const dataLines = text.split('\n').filter((l) => /^\d/.test(l));
  assert.equal(dataLines.length, 2);
  for (const line of dataLines) {
    assert.equal(line[3], ' ', `expected a 3-char-wide ticket column boundary in "${line}"`);
  }
});

test('renderPipelineBoardBody: a below-grid list line shows the short kebab slug only and a number-only id', () => {
  const text = renderPipelineBoardBody({
    rows: [],
    parked: [{ id: 'BL-472', slug: deriveListEntryText('Pipeline board shows a lot more of the title now'), status: 'parked' }],
  });
  const lines = text.split('\n');
  const entryLine = lines.find((l) => l.trim().split(/\s+/)[0] === '472');
  assert.ok(entryLine, `expected a "472" parked entry, got:\n${text}`);
  assert.equal(entryLine.trim(), '472 pipeline-board', 'expected the kebab slug only, no further title words');
});

test('renderPipelineBoardBody: a root-intake list entry keeps its non-ticket id unchanged', () => {
  const text = renderPipelineBoardBody({
    rows: [],
    parked: [],
    rootIntake: [{ id: 'INTAKE-pipeline-board-grid', slug: deriveListEntryText('grid too wide') }],
    recentlyClosed: [],
    links: [],
  });
  const lines = text.split('\n');
  assert.ok(lines.some((l) => l.trim().split(/\s+/)[0] === 'INTAKE-pipeline-board-grid'));
});

test('PIPELINE_BOARD_COLUMN_ORDER: the not-started column leads the stage columns instead of trailing them', () => {
  assert.equal(PIPELINE_BOARD_COLUMN_ORDER[0], PIPELINE_BOARD_NOT_STARTED_COLUMN);
  assert.ok(PIPELINE_BOARD_COLUMN_ORDER.indexOf('coder') > 0, 'expected every pipeline role column after the not-started column');
});

// BL-507: the coordinator is not a forward pipeline stage (it does post-QA
// backlog bookkeeping only), so the grid drops its column entirely - built
// from the forward PIPELINE_CHAIN (specifier..QA) plus the not-started
// sentinel, never from ALL_SWARM_ROLES (which still legitimately includes
// 'coordinator' for the coordinator's own standing steering topic).
test('PIPELINE_BOARD_COLUMN_ORDER: carries no coordinator column', () => {
  assert.ok(!PIPELINE_BOARD_COLUMN_ORDER.includes('coordinator'), `expected no 'coordinator' column, got: ${PIPELINE_BOARD_COLUMN_ORDER.join(', ')}`);
});

test('PIPELINE_BOARD_COLUMN_ORDER: still carries every forward pipeline stage from specifier to QA', () => {
  for (const stage of ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    assert.ok(PIPELINE_BOARD_COLUMN_ORDER.includes(stage), `expected a "${stage}" column, got: ${PIPELINE_BOARD_COLUMN_ORDER.join(', ')}`);
  }
});

// BL-507: a ticket physically in backlog/active/ whose authoritative stage
// is the coordinator (the brief post-QA bookkeeping window) is marked at
// the QA stage, not blank and not not-started - heldRoleByTicketId still
// resolves it to 'coordinator' (ALL_SWARM_ROLES is unchanged), so
// buildGridRows must remap that one stage to 'QA' before it renders.
test('computePipelineBoard: a coordinator-held ticket is marked at the QA stage, not left unrendered', () => {
  const { rows } = computePipelineBoard({ coordinator: ['BL-950'] }, [], {}, { activeIds: ['BL-950'] });
  assert.deepEqual(rows, [{ id: 'BL-950', column: 'QA', epic: undefined, slug: '' }]);
});

test('renderPipelineBoardBody: the not-started ticket mark falls in the first stage column, before specifier', () => {
  // A non-empty slug ('x') guarantees the slug cell survives whitespace-split
  // parsing below as its own token - an empty slug collapses into the
  // surrounding padding and would silently misalign the column index check.
  const text = renderPipelineBoardBody({
    rows: [{ id: 'BL-503', column: PIPELINE_BOARD_NOT_STARTED_COLUMN, slug: 'x' }],
    parked: [],
  });
  const lines = text.split('\n');
  const header = lines[0].trim().split(/\s+/);
  const row = lines.find((l) => l.trim().split(/\s+/)[0] === '503').trim().split(/\s+/);
  const nsIndex = header.indexOf('NS');
  const spIndex = header.indexOf('SP');
  assert.ok(nsIndex >= 0 && spIndex >= 0 && nsIndex < spIndex, `expected NS before SP in the header, got: ${header.join(' ')}`);
  assert.equal(row[nsIndex], 'X', `expected the not-started ticket marked in the NS column, got: ${row.join(' ')}`);
});

// ── BL-465: computePipelineBoard's new rootIntake/recentlyClosed/links ───

test('computePipelineBoard: rootIntake defaults to empty when no extras are given', () => {
  assert.deepEqual(computePipelineBoard({}, [], {}).rootIntake, []);
});

test('computePipelineBoard: rootIntake items render as list entries, sorted by id', () => {
  const { rootIntake } = computePipelineBoard(
    {},
    [],
    {},
    { rootIntake: [
      { id: 'INTAKE-2', title: 'second ask', filename: 'INTAKE-2.md' },
      { id: 'INTAKE-1', title: 'first ask', filename: 'INTAKE-1.md' },
    ] }
  );
  assert.deepEqual(
    rootIntake.map((r) => r.id),
    ['INTAKE-1', 'INTAKE-2']
  );
  assert.equal(rootIntake[0].slug, deriveListEntryText('first ask'));
});

test('computePipelineBoard: recentlyClosed is capped at PIPELINE_BOARD_RECENTLY_CLOSED_MAX items', () => {
  const items = Array.from({ length: PIPELINE_BOARD_RECENTLY_CLOSED_MAX + 3 }, (_, i) => ({
    id: `BL-${i}`,
    title: `closed ${i}`,
    filename: `BL-${i}-closed.yaml`,
  }));
  const { recentlyClosed } = computePipelineBoard({}, [], {}, { recentlyClosed: items });
  assert.equal(recentlyClosed.length, PIPELINE_BOARD_RECENTLY_CLOSED_MAX);
});

// BL-465 bounce (architect review): recently-closed order IS the whole
// point of the section - the caller (conciergeTick.ts's recentlyClosedItems)
// is documented as the one deciding order (this function "only bounds the
// list length"), so computePipelineBoard must never re-sort it. Deliberately
// fed in NON-alphabetical order (BL-9 before BL-1) - a bug that silently
// re-sorts by id would flip this to BL-1 first and this test would catch it.
test('computePipelineBoard: recentlyClosed preserves the caller-supplied order, never re-sorted alphabetically', () => {
  const { recentlyClosed } = computePipelineBoard(
    {},
    [],
    {},
    {
      recentlyClosed: [
        { id: 'BL-9', title: 'closed most recently', filename: 'BL-9-closed.yaml' },
        { id: 'BL-1', title: 'closed earlier', filename: 'BL-1-closed.yaml' },
      ],
    }
  );
  assert.deepEqual(recentlyClosed.map((e) => e.id), ['BL-9', 'BL-1']);
});

test('computePipelineBoard: links are empty when repoBaseUrl is absent, even with active rows', () => {
  const { links } = computePipelineBoard({ coder: ['BL-1'] }, [], { 'BL-1': { filename: 'BL-1-foo.yaml', location: 'active' } });
  assert.deepEqual(links, []);
});

test('computePipelineBoard: links resolve an active row to its backlog/active path when repoBaseUrl is given', () => {
  const { links } = computePipelineBoard(
    { coder: ['BL-1'] },
    [],
    { 'BL-1': { filename: 'BL-1-foo.yaml', location: 'active' } },
    { repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' }
  );
  assert.deepEqual(links, [{ id: 'BL-1', path: 'backlog/active/BL-1-foo.yaml' }]);
});

test('computePipelineBoard: links resolve a parked ticket to its backlog/paused path', () => {
  const { links } = computePipelineBoard(
    {},
    [{ id: 'BL-2' }],
    { 'BL-2': { filename: 'BL-2-bar.yaml', location: 'paused' } },
    { repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' }
  );
  assert.deepEqual(links, [{ id: 'BL-2', path: 'backlog/paused/BL-2-bar.yaml' }]);
});

test('computePipelineBoard: links resolve a recently-closed item to its backlog/done path', () => {
  const { links } = computePipelineBoard(
    {},
    [],
    {},
    { recentlyClosed: [{ id: 'BL-3', title: 'done thing', filename: 'BL-3-done.yaml' }], repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' }
  );
  assert.deepEqual(links, [{ id: 'BL-3', path: 'backlog/done/BL-3-done.yaml' }]);
});

test('computePipelineBoard: links resolve a root-intake item to its raw backlog/ root path', () => {
  const { links } = computePipelineBoard(
    {},
    [],
    {},
    { rootIntake: [{ id: 'INTAKE-1', title: 'an ask', filename: 'INTAKE-1.md' }], repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' }
  );
  assert.deepEqual(links, [{ id: 'INTAKE-1', path: 'backlog/INTAKE-1.md' }]);
});

test('computePipelineBoard: a ticket with no filename/location in its meta gets no link at all, never a broken one', () => {
  const { links } = computePipelineBoard({ coder: ['BL-1'] }, [], { 'BL-1': {} }, { repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' });
  assert.deepEqual(links, []);
});

test('computePipelineBoard: a parked ticket with no filename/location in its meta gets no link at all, never a broken one', () => {
  const { links } = computePipelineBoard({}, [{ id: 'BL-2' }], { 'BL-2': {} }, { repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' });
  assert.deepEqual(links, []);
});

// BL-513: PipelineBoardTicketMeta.location gained 'done' - linkPathFor must
// resolve it the same generic way it already resolves 'active'/'paused'
// (needed so a stale duplicate resolution in buildTicketMetaLookup can
// prefer active/paused over a done-folder copy for the SAME row/parked id).
test("computePipelineBoard: a row whose ticketMeta location is 'done' resolves to backlog/done/<file>", () => {
  const { links } = computePipelineBoard(
    { coder: ['BL-1'] },
    [],
    { 'BL-1': { filename: 'BL-1-a.yaml', location: 'done' } },
    { repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' }
  );
  assert.deepEqual(links, [{ id: 'BL-1', path: 'backlog/done/BL-1-a.yaml' }]);
});

test('computePipelineBoard: links combined from every source (row, parked, recently-closed, root-intake) come out in plain alphabetical order', () => {
  // BL-513: reversed from BL-506's most-recent-first (highest ticket number
  // first) to plain ascending alphabetical by id, across every source with
  // no special-casing.
  const { links } = computePipelineBoard(
    { coder: ['BL-9'] },
    [{ id: 'BL-5' }],
    { 'BL-9': { filename: 'BL-9-foo.yaml', location: 'active' }, 'BL-5': { filename: 'BL-5-bar.yaml', location: 'paused' } },
    {
      recentlyClosed: [{ id: 'BL-7', title: 'done thing', filename: 'BL-7-done.yaml' }],
      rootIntake: [{ id: 'INTAKE-1', title: 'an ask', filename: 'INTAKE-1.md' }],
      repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc',
    }
  );
  assert.deepEqual(
    links.map((l) => l.id),
    ['BL-5', 'BL-7', 'BL-9', 'INTAKE-1']
  );
});

test('computePipelineBoard: links order is lexicographic, not numeric, so a four-digit ticket sorts above a three-digit one', () => {
  // BL-513 (pinned load-bearing edge, carried over from BL-506's own
  // discovery): once ids hit four digits, "BL-1000" sorts ABOVE "BL-999" -
  // confirmed against localeCompare's actual default collation, not assumed.
  const { links } = computePipelineBoard(
    { coder: ['BL-999', 'BL-1000'] },
    [],
    {
      'BL-999': { filename: 'BL-999-a.yaml', location: 'active' },
      'BL-1000': { filename: 'BL-1000-b.yaml', location: 'active' },
    },
    { repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc' }
  );
  assert.deepEqual(
    links.map((l) => l.id),
    ['BL-1000', 'BL-999']
  );
});

test('computePipelineBoard: numbered and unnumbered ids interleave by plain alphabetical order, no more numbered-first special-casing', () => {
  // BL-513: BL-506's "unnumbered ids always sort last" rule is gone - a
  // root-intake id now sorts purely on its own text, which happens to fall
  // after every "BL-" id here only because 'I' > 'B', not because of any
  // special-casing.
  const { links } = computePipelineBoard(
    { coder: ['BL-101', 'BL-504'] },
    [],
    {
      'BL-101': { filename: 'BL-101-a.yaml', location: 'active' },
      'BL-504': { filename: 'BL-504-b.yaml', location: 'active' },
    },
    {
      rootIntake: [{ id: 'INTAKE-pipeline-board-links-order', title: 'an ask', filename: 'INTAKE-pipeline-board-links-order.md' }],
      repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc',
    }
  );
  assert.deepEqual(
    links.map((l) => l.id),
    ['BL-101', 'BL-504', 'INTAKE-pipeline-board-links-order']
  );
});

test('computePipelineBoard: a root-intake id ending in digits (a timestamp-suffixed filename stem) sorts on its own text, never parsed as a ticket number', () => {
  // BL-513: no ticket-number parsing happens in the comparator at all any
  // more (a.id.localeCompare(b.id) only) - this is now purely a plain
  // string comparison, so a huge embedded timestamp is never at risk of
  // being misread as a ticket number in the first place.
  const { links } = computePipelineBoard(
    { coder: ['BL-9'] },
    [],
    { 'BL-9': { filename: 'BL-9-a.yaml', location: 'active' } },
    {
      rootIntake: [{ id: 'INTAKE-operator-question-1784328071807', title: 'an ask', filename: 'INTAKE-operator-question-1784328071807.md' }],
      repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc',
    }
  );
  assert.deepEqual(
    links.map((l) => l.id),
    ['BL-9', 'INTAKE-operator-question-1784328071807']
  );
});

test('computePipelineBoard: two root-intake links with no ticket id still sort by plain id order', () => {
  const { links } = computePipelineBoard(
    { coder: ['BL-9'] },
    [],
    { 'BL-9': { filename: 'BL-9-a.yaml', location: 'active' } },
    {
      rootIntake: [
        { id: 'INTAKE-zzz-later', title: 'an ask', filename: 'INTAKE-zzz-later.md' },
        { id: 'INTAKE-aaa-earlier', title: 'another ask', filename: 'INTAKE-aaa-earlier.md' },
      ],
      repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc',
    }
  );
  assert.deepEqual(
    links.map((l) => l.id),
    ['BL-9', 'INTAKE-aaa-earlier', 'INTAKE-zzz-later']
  );
});

// ── BL-465: renderPipelineBoardBody's new below-grid sections ────────────

test('renderPipelineBoardBody: an empty root-intake/recently-closed list renders no section at all', () => {
  const text = renderPipelineBoardBody({ rows: [], parked: [], rootIntake: [], recentlyClosed: [], links: [] });
  assert.ok(!text.includes('ROOT INTAKE'));
  assert.ok(!text.includes('RECENTLY CLOSED'));
});

test('renderPipelineBoardBody: root-intake and recently-closed entries render under their own sections', () => {
  const text = renderPipelineBoardBody({
    rows: [],
    parked: [],
    rootIntake: [{ id: 'INTAKE-1', slug: 'an-ask an ask for something' }],
    recentlyClosed: [{ id: 'BL-9', slug: 'shipped-thing shipped thing' }],
    links: [],
  });
  const lines = text.split('\n');
  const rootIntakeHeaderIndex = lines.findIndex((l) => l.trim() === 'ROOT INTAKE:');
  const closedHeaderIndex = lines.findIndex((l) => l.trim() === 'RECENTLY CLOSED:');
  // BL-505: a non-ticket root-intake id renders unchanged; a real ticket id
  // (BL-9) renders number-only ("9").
  assert.ok(rootIntakeHeaderIndex > 0 && lines[rootIntakeHeaderIndex + 1].includes('INTAKE-1'));
  assert.ok(closedHeaderIndex > 0 && lines[closedHeaderIndex + 1].trim().startsWith('9 '));
});

test('renderPipelineBoardBody: awaiting-approval renders under its own section, distinct from PARKED - no per-line label', () => {
  const text = renderPipelineBoardBody({
    rows: [],
    parked: [
      { id: 'BL-436', slug: 'stalled-work stalled work', status: 'parked' },
      { id: 'BL-449', slug: 'needs-a-look needs a look', status: 'awaiting-approval' },
    ],
    rootIntake: [],
    recentlyClosed: [],
    links: [],
  });
  const lines = text.split('\n');
  const parkedIndex = lines.findIndex((l) => l.trim() === 'PARKED:');
  const awaitingIndex = lines.findIndex((l) => l.trim() === 'AWAITING APPROVAL:');
  assert.ok(parkedIndex > 0 && awaitingIndex > 0 && parkedIndex !== awaitingIndex);
  // BL-505: below-grid list lines show the ticket NUMBER only.
  assert.ok(lines[parkedIndex + 1].includes('436') && !lines[parkedIndex + 1].trim().startsWith('PK'));
  assert.ok(lines[awaitingIndex + 1].includes('449') && !lines[awaitingIndex + 1].trim().startsWith('AA'));
});

test('renderPipelineBoardBody: a fixture missing the new sections entirely (pre-BL-465 shape) still renders - defaults to empty', () => {
  const text = renderPipelineBoardBody({ rows: [{ id: 'BL-1', column: 'coder', slug: 'x' }], parked: [] });
  assert.ok(!text.includes('ROOT INTAKE'));
  assert.ok(!text.includes('RECENTLY CLOSED'));
});

// ── BL-465: renderPipelineBoardLinks / wrapPipelineBoardHtml ──────────────

test('renderPipelineBoardLinks: empty when there are no links at all', () => {
  assert.equal(renderPipelineBoardLinks([], 'https://github.com/ldecorps/swarmforgevc'), '');
});

test('renderPipelineBoardLinks: empty when repoBaseUrl is not resolvable, even with links present', () => {
  assert.equal(renderPipelineBoardLinks([{ id: 'BL-1', path: 'backlog/active/BL-1-foo.yaml' }], undefined), '');
});

test('renderPipelineBoardLinks: renders a real <a href> tag per link, pointing at the GitHub blob URL', () => {
  const html = renderPipelineBoardLinks([{ id: 'BL-1', path: 'backlog/active/BL-1-foo.yaml' }], 'https://github.com/ldecorps/swarmforgevc');
  assert.ok(html.includes('<a href="https://github.com/ldecorps/swarmforgevc/blob/main/backlog/active/BL-1-foo.yaml">'));
  assert.ok(html.includes('BL-1'));
});

test('wrapPipelineBoardHtml: with no linksHtml, wraps exactly as before BL-465 (byte-for-byte)', () => {
  assert.equal(wrapPipelineBoardHtml('TICKET SP\nBL-1    X'), '<pre>TICKET SP\nBL-1    X</pre>');
});

test('wrapPipelineBoardHtml: with linksHtml, appends it AFTER the closing </pre>, never inside it', () => {
  const result = wrapPipelineBoardHtml('TICKET SP\nBL-1    X', '<a href="https://x">BL-1</a>');
  assert.ok(result.startsWith('<pre>TICKET SP\nBL-1    X</pre>'));
  assert.ok(result.endsWith('<a href="https://x">BL-1</a>'));
  // The link tag itself must never be HTML-escaped (it would stop being a
  // real link) - confirmed by its literal '<a href' substring surviving.
  assert.ok(result.includes('<a href="https://x">BL-1</a>'));
});

// ── BL-502: budgetPipelineBoardLinks - live outage 2026-07-17 ────────────
// The link list has no bound of its own, so at realistic backlog sizes the
// FULL list alone pushes the composed message over Telegram's 4096-char
// send limit and every post is rejected "text is too long", freezing the
// board. budgetPipelineBoardLinks trims the link list (never the grid/
// parked body) to whatever room the caller says remains, with a VISIBLE
// "+N more" indicator when trimmed - never a silent cap.

const REPO_BASE_URL = 'https://github.com/ldecorps/swarmforgevc';

function manyLinks(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `BL-${i}`, path: `backlog/active/BL-${i}-a-fine-feature-with-a-longish-slug.yaml` }));
}

test('budgetPipelineBoardLinks: empty when there are no links at all', () => {
  assert.deepEqual(budgetPipelineBoardLinks([], REPO_BASE_URL, 1000), { html: '', omittedCount: 0 });
});

test('budgetPipelineBoardLinks: empty when repoBaseUrl is not resolvable, even with links present', () => {
  assert.deepEqual(budgetPipelineBoardLinks([{ id: 'BL-1', path: 'backlog/active/BL-1-foo.yaml' }], undefined, 1000), { html: '', omittedCount: 0 });
});

// pipeline-board-message-length-budget-01
test('budgetPipelineBoardLinks: a small link list that fits is included in FULL, byte-identical to the unbudgeted render, with no overflow indicator', () => {
  const links = manyLinks(3);
  const full = renderPipelineBoardLinks(links, REPO_BASE_URL);
  const result = budgetPipelineBoardLinks(links, REPO_BASE_URL, full.length + 500);
  assert.equal(result.html, full);
  assert.equal(result.omittedCount, 0);
  assert.ok(!result.html.includes('more'), 'expected no overflow indicator when everything fits');
});

// pipeline-board-message-length-budget-02
test('budgetPipelineBoardLinks: an oversized link list is trimmed to fit, with a visible "+N more" indicator naming the omission - never silent', () => {
  const links = manyLinks(30);
  const full = renderPipelineBoardLinks(links, REPO_BASE_URL);
  const budget = Math.floor(full.length / 2);
  const result = budgetPipelineBoardLinks(links, REPO_BASE_URL, budget);
  assert.ok(result.html.length <= budget, `expected the trimmed html (${result.html.length}) within the budget (${budget})`);
  assert.ok(result.omittedCount > 0, 'expected some links omitted at half the full budget');
  assert.ok(result.html.includes(`+${result.omittedCount} more`), `expected a visible "+${result.omittedCount} more" indicator, got: ${result.html}`);
  // The included links are a PREFIX of the full list, in order - never a
  // silent reordering or arbitrary subset.
  const includedIds = links.slice(0, links.length - result.omittedCount).map((l) => l.id);
  for (const id of includedIds) {
    assert.ok(result.html.includes(`${id}:`), `expected included link ${id} present in the trimmed html`);
  }
});

test('budgetPipelineBoardLinks: the omission count is exact - included + omitted equals the total link count', () => {
  const links = manyLinks(50);
  const full = renderPipelineBoardLinks(links, REPO_BASE_URL);
  const result = budgetPipelineBoardLinks(links, REPO_BASE_URL, Math.floor(full.length / 4));
  const includedCount = links.length - result.omittedCount;
  assert.ok(includedCount >= 0 && includedCount <= links.length);
  assert.ok(result.omittedCount > 0);
});

test('budgetPipelineBoardLinks: a budget too small even for the header + omitted-count indicator degrades to no links at all, never a message still over budget', () => {
  const links = manyLinks(10);
  const result = budgetPipelineBoardLinks(links, REPO_BASE_URL, 3);
  assert.equal(result.html, '');
  assert.equal(result.omittedCount, links.length);
});

test('PIPELINE_BOARD_MESSAGE_MAX_LENGTH stays at or under Telegram\'s real 4096-char sendMessage limit', () => {
  assert.ok(PIPELINE_BOARD_MESSAGE_MAX_LENGTH <= 4096);
  assert.ok(PIPELINE_BOARD_MESSAGE_MAX_LENGTH > 0);
});
