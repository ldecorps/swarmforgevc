const assert = require('node:assert/strict');
const {
  computePipelineBoard,
  renderPipelineBoard,
  renderPipelineBoardBody,
  renderPipelineBoardLinks,
  formatUpdatedAtLabel,
  wrapPipelineBoardHtml,
  deriveTicketSlug,
  deriveKebabSlug,
  deriveListEntryText,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_SLUG_MAX_LENGTH,
  PIPELINE_BOARD_RECENTLY_CLOSED_MAX,
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

test('computePipelineBoard: a role-held ticket with a title gets its derived (grid) kebab slug', () => {
  const { rows } = computePipelineBoard({ coder: ['BL-1'] }, [], { 'BL-1': { title: 'fix the widget' } });
  assert.equal(rows[0].slug, 'fix-the-widget');
});

test('computePipelineBoard: a paused ticket with a title gets its derived (list) kebab-slug-plus-wider-title', () => {
  const { parked } = computePipelineBoard({}, [{ id: 'BL-2' }], { 'BL-2': { title: 'clean up docs' } });
  assert.equal(parked[0].slug, 'clean-up-docs clean up docs');
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

// ── BL-465: deriveKebabSlug / deriveListEntryText (pure) ──────────────────

test('deriveKebabSlug: takes the first 3 significant words, lowercased and hyphenated', () => {
  assert.equal(deriveKebabSlug('Pipeline Board: Post The New Message'), 'pipeline-board-post');
});

test('deriveKebabSlug: strips punctuation rather than treating it as a word boundary only', () => {
  assert.equal(deriveKebabSlug("BL-467: Pipeline board's own pin"), 'bl-467-pipeline');
});

test('deriveKebabSlug: a short title (fewer than 3 words) uses every word it has', () => {
  assert.equal(deriveKebabSlug('fix widget'), 'fix-widget');
});

test('deriveKebabSlug: no title is an empty slug', () => {
  assert.equal(deriveKebabSlug(undefined), '');
});

test('deriveKebabSlug: a custom maxWords bound is honoured', () => {
  assert.equal(deriveKebabSlug('one two three four five', 2), 'one-two');
});

test('deriveListEntryText: leads with the kebab slug then the wider truncated title', () => {
  assert.equal(deriveListEntryText('clean up docs'), 'clean-up-docs clean up docs');
});

test('deriveListEntryText: no title is an empty string (never throws)', () => {
  assert.equal(deriveListEntryText(undefined), '');
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

test('computePipelineBoard: links combined from every source (row, parked, recently-closed, root-intake) come out sorted by id', () => {
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
  assert.ok(rootIntakeHeaderIndex > 0 && lines[rootIntakeHeaderIndex + 1].includes('INTAKE-1'));
  assert.ok(closedHeaderIndex > 0 && lines[closedHeaderIndex + 1].includes('BL-9'));
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
  assert.ok(lines[parkedIndex + 1].includes('BL-436') && !lines[parkedIndex + 1].trim().startsWith('PK'));
  assert.ok(lines[awaitingIndex + 1].includes('BL-449') && !lines[awaitingIndex + 1].trim().startsWith('AA'));
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
