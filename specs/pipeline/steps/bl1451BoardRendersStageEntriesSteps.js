'use strict';

// BL-1451: step handlers for "the pipeline board renders BL-670's stage
// entries, health dot first". Drives the REAL computePipelineBoard/
// renderPipelineBoardBody over in-memory maps (the same pure-function
// shape BL-670's and BL-585's own handlers already use) - nothing here
// reads the live .swarmforge/.

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  computePipelineBoard,
  renderPipelineBoardBody,
  deriveDisplayTicketId,
  HEALTH_DOT_GLYPHS,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'pipelineBoard'));

const FEATURE = "BL-1451 The pipeline board renders BL-670's stage entries, health dot first";

const MAPPED_ID = 'BL-9001';
const UNMAPPED_ID = 'BL-9002';
const KNOWN_COLOURS = new Set(['green', 'yellow', 'red']);
const KNOWN_ENTRY_KINDS = new Set(['absent', 'without a dot']);

function baseState() {
  return {
    roleHeld: { coder: [MAPPED_ID], architect: [UNMAPPED_ID] },
    paused: [],
    ticketMeta: {
      [MAPPED_ID]: { title: 'mapped ticket' },
      [UNMAPPED_ID]: { title: 'unmapped ticket' },
    },
    activeIds: [MAPPED_ID, UNMAPPED_ID],
    // The Background's own default entry - scenarios 01/02 override or
    // remove MAPPED_ID's entry via their own Given; scenario 03 (no
    // further Given at all) reads this default as-is.
    ticketStageEntries: {
      [MAPPED_ID]: { stage: 'coder', status: 'claimed', asOf: '2026-09-07T10:00:00Z', healthDot: 'green' },
    },
  };
}

function compute(ctx) {
  ctx.data = computePipelineBoard(ctx.roleHeld, ctx.paused, ctx.ticketMeta, {
    activeIds: ctx.activeIds,
    ticketStageEntries: ctx.ticketStageEntries,
  });
}

function computeAndRender(ctx) {
  compute(ctx);
  ctx.bodyWith = renderPipelineBoardBody(ctx.data);
  ctx.linesWith = ctx.bodyWith.split('\n');

  // The exact same fixture, with NO stage entries at all - the baseline
  // every "renders exactly as today" assertion compares against, rather
  // than a second, hand-restated expectation that could itself drift from
  // what the pre-BL-1451 renderer actually produced.
  const baselineData = computePipelineBoard(ctx.roleHeld, ctx.paused, ctx.ticketMeta, { activeIds: ctx.activeIds });
  ctx.bodyWithout = renderPipelineBoardBody(baselineData);
  ctx.linesWithout = ctx.bodyWithout.split('\n');
}

// The matrix (header + one row per ticket) always precedes the caption
// block, and renderGridCaptionLines always opens with a blank line - so
// the first '' line is the boundary. Isolates "stage cells" from the
// caption line the dot itself lives on.
function gridSection(lines) {
  const blankIdx = lines.indexOf('');
  return blankIdx === -1 ? lines : lines.slice(0, blankIdx);
}

// The caption block starts at the same blank line that closes the grid
// section - searched separately from it so a caption match can never pick
// up the matrix ROW instead (the matrix row's NBSP-padded id also
// `includes` the bare display id).
function captionSection(lines) {
  const blankIdx = lines.indexOf('');
  return blankIdx === -1 ? [] : lines.slice(blankIdx);
}

function captionLineFor(lines, id) {
  const displayId = deriveDisplayTicketId(id);
  return captionSection(lines).find((l) => l.includes(displayId));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ticket-stage map in BL-670's shape and the tickets it names held by roles$/, (ctx) => {
    Object.assign(ctx, baseState());
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the ticket's entry carries the health dot (green|yellow|red)$/, (ctx, colour) => {
    assert.ok(KNOWN_COLOURS.has(colour), `unknown Examples colour "${colour}"`);
    ctx.ticketStageEntries[MAPPED_ID] = { stage: 'coder', status: 'claimed', healthDot: colour };
    ctx.expectedColour = colour;
  });

  scoped(/^the board is computed and rendered$/, (ctx) => {
    computeAndRender(ctx);
  });

  scoped(/^the ticket's caption line begins with (🟢|🟡|🔴)$/, (ctx, glyph) => {
    if (ctx.expectedColour) {
      // Cross-checked against the production map itself, not restated -
      // a feature-file glyph that drifted from HEALTH_DOT_GLYPHS would
      // otherwise pass this assertion for the wrong reason.
      assert.equal(glyph, HEALTH_DOT_GLYPHS[ctx.expectedColour], 'the Examples glyph disagrees with HEALTH_DOT_GLYPHS');
    }
    const caption = captionLineFor(ctx.linesWith, MAPPED_ID);
    assert.ok(caption, `no caption line for ${MAPPED_ID}:\n${ctx.bodyWith}`);
    assert.ok(
      caption.startsWith(`${glyph} ${deriveDisplayTicketId(MAPPED_ID)}`),
      `expected caption to begin with "${glyph} ${deriveDisplayTicketId(MAPPED_ID)}", got: ${JSON.stringify(caption)}`
    );
  });

  scoped(/^the ticket's stage cells are unchanged$/, (ctx) => {
    assert.deepEqual(
      gridSection(ctx.linesWith),
      gridSection(ctx.linesWithout),
      `stage cells changed:\nwith:\n${gridSection(ctx.linesWith).join('\n')}\nwithout:\n${gridSection(ctx.linesWithout).join('\n')}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the ticket's entry is (absent|without a dot)$/, (ctx, entry) => {
    assert.ok(KNOWN_ENTRY_KINDS.has(entry), `unknown Examples entry "${entry}"`);
    if (entry === 'absent') {
      delete ctx.ticketStageEntries[MAPPED_ID];
    } else {
      ctx.ticketStageEntries[MAPPED_ID] = { stage: 'coder', status: 'claimed' };
    }
  });

  scoped(/^the ticket's caption line begins with its display id$/, (ctx) => {
    const caption = captionLineFor(ctx.linesWith, MAPPED_ID);
    const displayId = deriveDisplayTicketId(MAPPED_ID);
    assert.ok(caption, `no caption line for ${MAPPED_ID}:\n${ctx.bodyWith}`);
    assert.ok(
      caption.startsWith(displayId),
      `expected caption to begin with the bare display id "${displayId}" (no dot), got: ${JSON.stringify(caption)}`
    );
  });

  scoped(/^the grid line width is unchanged$/, (ctx) => {
    assert.deepEqual(
      gridSection(ctx.linesWith),
      gridSection(ctx.linesWithout),
      'grid section differs (width or content) with a dot-less/absent entry vs no entries at all'
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the board is computed$/, (ctx) => {
    compute(ctx);
  });

  scoped(/^each row for a mapped ticket carries the entry's status and as-of time$/, (ctx) => {
    const row = ctx.data.rows.find((r) => r.id === MAPPED_ID);
    const entry = ctx.ticketStageEntries[MAPPED_ID];
    assert.ok(row, `no row for ${MAPPED_ID}`);
    assert.ok(row.stageEntry, `row for ${MAPPED_ID} carries no stageEntry at all`);
    assert.equal(row.stageEntry.status, entry.status);
    assert.equal(row.stageEntry.asOf, entry.asOf);
  });

  scoped(/^a row for an unmapped ticket carries neither$/, (ctx) => {
    const row = ctx.data.rows.find((r) => r.id === UNMAPPED_ID);
    assert.ok(row, `no row for ${UNMAPPED_ID}`);
    assert.equal(row.stageEntry, undefined, `expected no stageEntry on the unmapped row, got: ${JSON.stringify(row.stageEntry)}`);
  });
}

module.exports = { registerSteps };
