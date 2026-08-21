'use strict';

// BL-979: step handlers for "the pipeline board renders tickets as rows with
// epic separators in the caption list". Drives the real, compiled
// pipelineBoard module directly - never a reimplementation of the matrix
// layout, the row budget or the caption grouping. No filesystem fixture
// anywhere: every scenario builds its PipelineBoardData in memory, same as
// the module's own unit tests and the BL-585 handlers this file succeeds.
//
// Invariant 1 (BL-968) applies here: module load is requires and pure
// constants only - everything environmental binds at step-execution time.

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  computePipelineBoard,
  renderPipelineBoardBody,
  renderPipelineBoardGridOnly,
  deriveDisplayTicketId,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_GRID_MAX_WIDTH,
  PIPELINE_BOARD_GRID_MAX_ROWS,
  PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'pipelineBoard'));

const FEATURE = 'BL-979 the pipeline board renders tickets as rows with epic separators in the caption list';
const NBSP = ' ';
const STAGE_GLYPHS = ['NS', 'SP', 'CO', 'CL', 'AR', 'HD', 'DC', 'QA'];
const STAGE_CELL_WIDTH = 2;

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const EPIC_MEMBERSHIPS = {
  'some tickets carry no epic and others do': 'mixed',
  'no ticket carries an epic at all': 'none',
};

const SEPARATOR_EXPECTATIONS = {
  'ends with a "-- (no epic) --" group holding those tickets': 'noEpicGroupLast',
  'contains no separator line': 'noSeparators',
};

const ID_WIDTHS = { 3: 100, 4: 1000, 5: 10000 };

const BACKLOG_ENTRIES = {
  'a title longer than the caption budget': 'longTitle',
  absent: 'absent',
};

function requireKnown(table, token, what) {
  if (!(token in table)) {
    throw new Error(`unknown <${what}> token: "${token}" - known: ${Object.keys(table).join(' | ')}`);
  }
  return table[token];
}

function matrixLine(gutter, cells, cellWidth) {
  return gutter + cells.map((c) => NBSP + c.padStart(cellWidth, NBSP)).join('');
}

const stageHeader = (gutterWidth) => matrixLine(NBSP.repeat(gutterWidth), STAGE_GLYPHS, STAGE_CELL_WIDTH);
const ticketRow = (displayId, gutterWidth, heldStage) =>
  matrixLine(
    displayId.padStart(gutterWidth, NBSP),
    STAGE_GLYPHS.map((g) => (g === heldStage ? 'X' : '.')),
    STAGE_CELL_WIDTH
  );

// The matrix runs from the header to the first blank line; everything after
// is the caption block. No grid line is ever empty, so the boundary is
// unambiguous.
function dissect(text) {
  const lines = text.split('\n');
  const firstBlank = lines.indexOf('');
  const grid = firstBlank === -1 ? lines : lines.slice(0, firstBlank);
  const tail = firstBlank === -1 ? [] : lines.slice(firstBlank + 1);
  return {
    lines,
    header: grid[0],
    rows: grid.slice(1),
    separators: tail.filter((l) => l.startsWith('-- ')),
    summaries: tail.filter((l) => l !== '' && !l.startsWith('-- ') && !/^\+\d+ more active$/.test(l)),
    overflow: tail.find((l) => /^\+\d+ more active$/.test(l)),
  };
}

function render(ctx) {
  ctx.text = renderPipelineBoardBody(ctx.data);
  ctx.board = dissect(ctx.text);
  return ctx.board;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a pipeline board rendered from the active backlog$/, (ctx) => {
    ctx.rows = [];
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────
  scoped(/^active tickets held at distinct pipeline stages$/, (ctx) => {
    // One ticket per stage, so "each row marks its own held column" is
    // exercised across every column rather than one lucky one.
    const roleHeldTickets = { coder: ['BL-102'], QA: ['BL-103'], cleaner: ['BL-104'] };
    ctx.expected = [
      ['101', 'NS'],
      ['102', 'CO'],
      ['103', 'QA'],
      ['104', 'CL'],
    ];
    ctx.data = computePipelineBoard(roleHeldTickets, [], {}, { activeIds: ['BL-101', 'BL-102', 'BL-103', 'BL-104'] });
  });

  scoped(/^the board grid renders$/, (ctx) => {
    render(ctx);
  });

  scoped(/^the header row lists the stage glyphs "([^"]+)" left to right$/, (ctx, glyphs) => {
    const expected = glyphs.split(' ');
    assert.deepEqual(expected, STAGE_GLYPHS, `unexpected <glyphs> token: ${glyphs}`);
    assert.equal(ctx.board.header, stageHeader(3), `header mismatch:\n${ctx.text}`);
    assert.deepEqual(ctx.board.header.split(NBSP).filter(Boolean), expected);
    assert.equal(expected.length, PIPELINE_BOARD_COLUMN_ORDER.length, 'one glyph per pipeline column');
  });

  scoped(/^each active ticket occupies exactly one row labelled with its display id$/, (ctx) => {
    assert.equal(ctx.board.rows.length, ctx.expected.length, `expected one row per ticket:\n${ctx.text}`);
    const gutterIds = ctx.board.rows.map((l) => l.slice(0, 3).trim());
    assert.deepEqual(gutterIds, ctx.expected.map(([id]) => id));
  });

  scoped(/^each row marks "X" in its held stage column and "\." in every other$/, (ctx) => {
    ctx.expected.forEach(([id, stage], i) => {
      assert.equal(ctx.board.rows[i], ticketRow(id, 3, stage), `row for ${id} (held at ${stage}):\n${ctx.text}`);
    });
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^active tickets belonging to more than one epic$/, (ctx) => {
    ctx.meta = {
      'BL-201': { epic: 'code-quality-gates', title: 'first slice of work' },
      'BL-202': { epic: 'code-quality-gates', title: 'second slice of work' },
      'BL-203': { epic: 'pipeline-board', title: 'third slice of work' },
    };
    ctx.data = computePipelineBoard({ coder: ['BL-201'], QA: ['BL-203'] }, [], ctx.meta, {
      activeIds: Object.keys(ctx.meta),
    });
  });

  scoped(/^the board caption list renders$/, (ctx) => {
    render(ctx);
  });

  scoped(/^each epic group opens with a separator line "-- <epic-slug> --"$/, (ctx) => {
    const epics = [...new Set(Object.values(ctx.meta).map((m) => m.epic))].filter(Boolean);
    assert.deepEqual(
      ctx.board.separators,
      epics.map((e) => `-- ${e} --`),
      `expected one separator per epic, in epic order:\n${ctx.text}`
    );
    // "Opens" the group: the first summary of each epic follows its own
    // separator, with nothing but a blank line between.
    for (const epic of epics) {
      const sepIndex = ctx.board.lines.indexOf(`-- ${epic} --`);
      const firstId = Object.keys(ctx.meta).find((id) => ctx.meta[id].epic === epic);
      const summaryIndex = ctx.board.lines.findIndex((l) => l.startsWith(`${deriveDisplayTicketId(firstId)} `));
      assert.equal(summaryIndex, sepIndex + 2, `"-- ${epic} --" must open its group:\n${ctx.text}`);
    }
  });

  scoped(/^every ticket summary is preceded by a blank line$/, (ctx) => {
    assert.ok(ctx.board.summaries.length > 0, `no summaries rendered:\n${ctx.text}`);
    for (const summary of ctx.board.summaries) {
      const i = ctx.board.lines.indexOf(summary);
      assert.equal(ctx.board.lines[i - 1], '', `no blank line before "${summary}":\n${ctx.text}`);
    }
  });

  scoped(/^each summary line is the display id followed by the truncated ticket title$/, (ctx) => {
    assert.deepEqual(
      ctx.board.summaries,
      Object.entries(ctx.meta).map(([id, m]) => `${deriveDisplayTicketId(id)} ${m.title}`)
    );
  });

  // ── Scenario 03 (Outline) ─────────────────────────────────────────────
  scoped(/^active tickets where (.+)$/, (ctx, token) => {
    const membership = requireKnown(EPIC_MEMBERSHIPS, token, 'epic_membership');
    ctx.meta =
      membership === 'mixed'
        ? {
            'BL-301': { epic: 'code-quality-gates', title: 'has an epic' },
            'BL-302': { title: 'carries none' },
          }
        : {
            'BL-301': { title: 'carries none' },
            'BL-302': { title: 'also carries none' },
          };
    ctx.membership = membership;
    ctx.data = computePipelineBoard({ coder: ['BL-301'] }, [], ctx.meta, { activeIds: Object.keys(ctx.meta) });
  });

  // Anchored to the two known expectations rather than a greedy (.+):
  // scenario 04's "the caption list covers exactly the visible rows" shares
  // this prefix, and a greedy pattern registered first swallows it - a
  // same-feature collision the scoped registry cannot disambiguate for us.
  scoped(/^the caption list (ends with .+|contains no separator line)$/, (ctx, token) => {
    const expectation = requireKnown(SEPARATOR_EXPECTATIONS, token, 'separator_expectation');
    if (expectation === 'noSeparators') {
      assert.deepEqual(ctx.board.separators, [], `expected no separator on a wholly epic-less board:\n${ctx.text}`);
      return;
    }
    const last = ctx.board.separators[ctx.board.separators.length - 1];
    assert.equal(last, '-- (no epic) --', `expected the epic-less group last:\n${ctx.text}`);
    const sepIndex = ctx.board.lines.indexOf('-- (no epic) --');
    const epicLess = Object.keys(ctx.meta).filter((id) => ctx.meta[id].epic === undefined);
    for (const id of epicLess) {
      const i = ctx.board.lines.findIndex((l) => l.startsWith(`${deriveDisplayTicketId(id)} `));
      assert.ok(i > sepIndex, `${id} must sit under the "(no epic)" separator:\n${ctx.text}`);
    }
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────
  scoped(/^more active tickets than the board's row budget allows$/, (ctx) => {
    ctx.overBudgetBy = 3;
    const meta = {};
    for (let i = 0; i < PIPELINE_BOARD_GRID_MAX_ROWS + ctx.overBudgetBy; i += 1) {
      meta[`BL-${400 + i}`] = { epic: 'code-quality-gates', title: `slice ${i}` };
    }
    ctx.meta = meta;
    ctx.orderedIds = Object.keys(meta);
    ctx.data = computePipelineBoard({}, [], meta, { activeIds: ctx.orderedIds });
  });

  scoped(/^the visible rows are the leading tickets of the same epic-grouped order$/, (ctx) => {
    const expected = ctx.orderedIds.slice(0, PIPELINE_BOARD_GRID_MAX_ROWS).map((id) => deriveDisplayTicketId(id));
    assert.deepEqual(ctx.board.rows.map((l) => l.trimStart().split(NBSP)[0]), expected);
  });

  scoped(/^a "\+N more active" line names how many rows were dropped$/, (ctx) => {
    assert.equal(ctx.board.overflow, `+${ctx.overBudgetBy} more active`, `overflow line:\n${ctx.text}`);
  });

  scoped(/^the caption list covers exactly the visible rows$/, (ctx) => {
    const visible = ctx.orderedIds.slice(0, PIPELINE_BOARD_GRID_MAX_ROWS).map((id) => deriveDisplayTicketId(id));
    assert.deepEqual(ctx.board.summaries.map((l) => l.split(' ')[0]), visible);
  });

  // ── Scenario 05 (Outline) ─────────────────────────────────────────────
  scoped(/^every active ticket's display id is (\d+) characters wide$/, (ctx, widthToken) => {
    const base = ID_WIDTHS[widthToken];
    if (base === undefined) {
      throw new Error(`unknown <id_width> token: "${widthToken}" - known: ${Object.keys(ID_WIDTHS).join(' | ')}`);
    }
    ctx.idWidth = Number(widthToken);
    ctx.idBase = base;
  });

  scoped(/^the active ticket count is within the row budget$/, (ctx) => {
    const ids = Array.from({ length: PIPELINE_BOARD_GRID_MAX_ROWS }, (_, i) => `BL-${ctx.idBase + i}`);
    ctx.orderedIds = ids;
    ctx.data = computePipelineBoard({}, [], {}, { activeIds: ids });
  });

  scoped(/^no row is dropped for width$/, (ctx) => {
    ctx.text = renderPipelineBoardGridOnly(ctx.data);
    ctx.board = dissect(ctx.text);
    assert.equal(ctx.board.rows.length, ctx.orderedIds.length, `every ticket must keep its row:\n${ctx.text}`);
    assert.equal(ctx.board.overflow, undefined, `nothing may be dropped here:\n${ctx.text}`);
  });

  scoped(/^the widest grid line is at most the board's grid width budget$/, (ctx) => {
    const widest = Math.max(...[ctx.board.header, ...ctx.board.rows].map((l) => l.length));
    // Width is a property of the STAGE SET plus the gutter (invariant 2),
    // so assert the exact arithmetic, not merely that it fits.
    assert.equal(widest, ctx.idWidth + STAGE_GLYPHS.length * (1 + STAGE_CELL_WIDTH));
    assert.ok(widest <= PIPELINE_BOARD_GRID_MAX_WIDTH, `${widest} exceeds ${PIPELINE_BOARD_GRID_MAX_WIDTH}`);
  });

  // ── Scenario 06 (Outline) ─────────────────────────────────────────────
  scoped(/^an active ticket whose backlog entry is (.+)$/, (ctx, token) => {
    const kind = requireKnown(BACKLOG_ENTRIES, token, 'backlog_entry');
    ctx.longTitle = 'x'.repeat(PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX + 20);
    const meta = kind === 'longTitle' ? { 'BL-948': { title: ctx.longTitle } } : {};
    ctx.data = computePipelineBoard({ coder: ['BL-948'] }, [], meta, { activeIds: ['BL-948'] });
  });

  scoped(/^its summary line reads "(.+)"$/, (ctx, expected) => {
    render(ctx);
    assert.equal(ctx.board.summaries.length, 1, `expected exactly one caption:\n${ctx.text}`);
    const actual = ctx.board.summaries[0];
    if (expected === '948 <truncated title>…') {
      assert.equal(actual, `948 ${'x'.repeat(PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX - 1)}…`);
      assert.ok(actual.endsWith('…'), 'truncation must stay visible');
      return;
    }
    if (expected === '948 (no backlog entry)') {
      assert.equal(actual, '948 (no backlog entry)');
      return;
    }
    throw new Error(`unknown <summary> token: "${expected}"`);
  });
}

module.exports = { registerSteps };
