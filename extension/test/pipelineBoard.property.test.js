const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  budgetPipelineBoardLinks,
  deriveKebabSlug,
  deriveDisplayTicketId,
  compareLinksMostRecentFirst,
  computePipelineBoard,
  renderPipelineBoardGridOnly,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_GRID_MAX_WIDTH,
  PIPELINE_BOARD_GRID_MAX_ROWS,
} = require('../out/concierge/pipelineBoard');
const { ALL_SWARM_ROLES } = require('../out/concierge/roleTopicMapStore');

// BL-502 (architect, property-testing support): budgetPipelineBoardLinks is
// the pure trim function this ticket introduced to keep the pipeline board's
// composed Telegram message under the send limit - it decides, for any link
// list and any remaining budget, how large a PREFIX of the list still fits.
// pipelineBoard.test.js pins this with a handful of hand-picked sizes/budgets
// (3 links that fit, 30/50 that don't, a budget too small even for the
// overflow indicator); the within-budget and prefix-conservation contract
// holds for every list size and every non-negative budget, not just those
// examples - the "conservation/counting" and "ordering/monotonicity" shapes
// architect.prompt's Property Testing section names. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs); excluded from
// the normal unit/coverage/mutation run.

const REPO_BASE_URL = 'https://github.com/ldecorps/swarmforgevc';

function links(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `L${i}`, path: `backlog/active/L${i}-a-fine-feature.yaml` }));
}

// The realistic domain: syncPipelineBoard always computes a non-negative-in-
// practice budget (the grid/parked body is small and bounded, per the
// ticket's own notes); a negative budget is the documented pathological
// case that degrades to no links; this property covers the domain the
// function is actually called with.
const budgetArb = fc.integer({ min: 0, max: 4000 });
const countArb = fc.integer({ min: 0, max: 80 });

test('property: the trimmed html never exceeds the given budget, for any link-list size and any non-negative budget', () => {
  fc.assert(
    fc.property(countArb, budgetArb, (count, maxLinksLength) => {
      const result = budgetPipelineBoardLinks(links(count), REPO_BASE_URL, maxLinksLength);
      assert.ok(
        result.html.length <= maxLinksLength,
        `count=${count} budget=${maxLinksLength} produced html.length=${result.html.length}`
      );
    })
  );
});

// The included links are always the largest PREFIX of the original list
// that fits - never a reordering, never a hole in the middle. omittedCount
// alone pins the covered links; check every id before the cut is present
// and every id at/after the cut is absent, which also proves omittedCount
// itself is exact (included + omitted === total, by construction of the
// slice), a conservation check on top of the ordering one.
test('property: the included links are always an in-order PREFIX of the input, and omittedCount is exact', () => {
  fc.assert(
    fc.property(countArb, budgetArb, (count, maxLinksLength) => {
      const list = links(count);
      const result = budgetPipelineBoardLinks(list, REPO_BASE_URL, maxLinksLength);
      const includedCount = list.length - result.omittedCount;
      assert.ok(includedCount >= 0 && includedCount <= list.length, `includedCount=${includedCount} out of range for count=${count}`);
      // d63e80320 shortened link lines to `<a href="...">label</a>` (no
      // `id: title` text), so the per-link marker is the anchor's display
      // label; the `</a>` suffix keeps L1 from matching inside L10.
      for (let i = 0; i < includedCount; i += 1) {
        assert.ok(result.html.includes(`>${deriveDisplayTicketId(list[i].id)}</a>`), `expected prefix link ${list[i].id} present, budget=${maxLinksLength}`);
      }
      for (let i = includedCount; i < list.length; i += 1) {
        assert.ok(!result.html.includes(`>${deriveDisplayTicketId(list[i].id)}</a>`), `expected tail link ${list[i].id} absent, budget=${maxLinksLength}`);
      }
    })
  );
});

// A larger budget can only ever include the same or more links, never
// fewer - monotonicity in the one dimension the caller actually varies
// (the room left after the grid/parked body shrinks or grows tick to tick).
test('property: a larger budget never includes fewer links than a smaller one, for the same list', () => {
  fc.assert(
    fc.property(countArb, budgetArb, budgetArb, (count, budgetA, budgetB) => {
      const [smaller, larger] = budgetA <= budgetB ? [budgetA, budgetB] : [budgetB, budgetA];
      const list = links(count);
      const resultSmaller = budgetPipelineBoardLinks(list, REPO_BASE_URL, smaller);
      const resultLarger = budgetPipelineBoardLinks(list, REPO_BASE_URL, larger);
      const includedSmaller = list.length - resultSmaller.omittedCount;
      const includedLarger = list.length - resultLarger.omittedCount;
      assert.ok(
        includedLarger >= includedSmaller,
        `budget ${smaller}->${includedSmaller} included, ${larger}->${includedLarger} included: expected non-decreasing`
      );
    })
  );
});

// BL-505 (architect, property-testing support): deriveKebabSlug and
// deriveDisplayTicketId are pure and were introduced/narrowed by this
// ticket. pipelineBoard.test.js pins each with a handful of hand-picked
// titles/ids; the invariants below hold for any title/maxWords or any id,
// not just those examples - the "ordering/counting" and "idempotence"
// shapes architect.prompt's Property Testing section names.

test('property: deriveKebabSlug never returns more than maxWords hyphenated words, for any title', () => {
  fc.assert(
    fc.property(fc.string(), fc.integer({ min: 1, max: 10 }), (title, maxWords) => {
      const slug = deriveKebabSlug(title, maxWords);
      const wordCount = slug === '' ? 0 : slug.split('-').length;
      assert.ok(wordCount <= maxWords, `title=${JSON.stringify(title)} maxWords=${maxWords} slug=${JSON.stringify(slug)} wordCount=${wordCount}`);
    })
  );
});

test('property: deriveDisplayTicketId is idempotent - re-stripping an already-displayed id is a no-op', () => {
  fc.assert(
    fc.property(fc.string(), (id) => {
      const once = deriveDisplayTicketId(id);
      const twice = deriveDisplayTicketId(once);
      assert.equal(twice, once, `id=${JSON.stringify(id)} once=${JSON.stringify(once)} twice=${JSON.stringify(twice)}`);
    })
  );
});

// BL-506 (architect, property-testing support): compareLinksMostRecentFirst is
// the pure comparator this ticket introduced for the LINKS section's order.
// pipelineBoard.test.js and the feature's Gherkin scenarios pin it with a
// handful of hand-picked id lists; the "every numbered link outranks every
// unnumbered one, and numbered links never increase" ordering contract holds
// for any list of ids, not just those examples - the "ordering/monotonicity"
// shape architect.prompt's Property Testing section names.

const TICKET_ID_PATTERN = /^(?:BL|GH)-(\d+)$/;
function ticketNumberOf(id) {
  const match = TICKET_ID_PATTERN.exec(id);
  return match ? Number(match[1]) : undefined;
}

const numberedIdArb = fc
  .tuple(fc.constantFrom('BL', 'GH'), fc.nat({ max: 10000 }))
  .map(([prefix, n]) => `${prefix}-${n}`);
const unnumberedIdArb = fc.string().map((s) => `INTAKE-${s}`);
const linkEntryArb = fc.oneof(numberedIdArb, unnumberedIdArb).map((id) => ({ id, path: `backlog/${id}.yaml` }));

test('property: sorting with compareLinksMostRecentFirst puts every numbered link before every unnumbered one, and numbered links are non-increasing by ticket number', () => {
  fc.assert(
    fc.property(fc.array(linkEntryArb, { maxLength: 50 }), (entries) => {
      const sorted = [...entries].sort(compareLinksMostRecentFirst);
      const numbers = sorted.map((e) => ticketNumberOf(e.id));
      let sawUnnumbered = false;
      let previousNumber;
      for (const n of numbers) {
        if (n === undefined) {
          sawUnnumbered = true;
          continue;
        }
        assert.ok(!sawUnnumbered, `numbered id found after an unnumbered one: ${JSON.stringify(numbers)}`);
        if (previousNumber !== undefined) {
          assert.ok(n <= previousNumber, `ticket numbers not non-increasing: ${JSON.stringify(numbers)}`);
        }
        previousNumber = n;
      }
    })
  );
});

// BL-507 (architect, property-testing support): buildGridRows (via
// computePipelineBoard) remaps a ticket held by a role ALL_SWARM_ROLES still
// carries but PIPELINE_BOARD_COLUMN_ORDER no longer does ('coordinator') onto
// the 'QA' column, so its row always lands on a real header column rather
// than an orphaned one with no matching cell. pipelineBoard.test.js and the
// BL-507 feature pin this with the single concrete 'coordinator' example;
// the invariant - every row's column is always a member of
// PIPELINE_BOARD_COLUMN_ORDER - holds for a ticket held by ANY of the
// ALL_SWARM_ROLES roles, not just that one example. This is the "never
// falls outside the render-able domain" conservation shape
// architect.prompt's Property Testing section names, and it is exactly the
// invariant this ticket's remap exists to protect: deleting the `heldRole
// === 'coordinator' ? 'QA' : heldRole` remap in buildGridRows makes this
// property fail for role='coordinator' (confirmed by temporarily removing
// the remap and re-running - it fails as expected, restored after).
const heldRoleArb = fc.constantFrom(...ALL_SWARM_ROLES);

test('property: a ticket held by any ALL_SWARM_ROLES role always renders on a real column, for any role', () => {
  fc.assert(
    fc.property(heldRoleArb, (role) => {
      const { rows } = computePipelineBoard({ [role]: ['BL-1'] }, [], {}, { activeIds: ['BL-1'] });
      assert.equal(rows.length, 1, `expected exactly one row for role=${role}`);
      assert.ok(
        PIPELINE_BOARD_COLUMN_ORDER.includes(rows[0].column),
        `role=${role} produced column=${rows[0].column}, not a member of PIPELINE_BOARD_COLUMN_ORDER=${PIPELINE_BOARD_COLUMN_ORDER.join(', ')}`
      );
    })
  );
});

// BL-979 (coder, declared invariants): the axis pivot moved the dropping
// axis from width to height, so the two invariants the ticket declares are
// exactly the two this property encodes.
//
//   1. "The board never drops a ticket silently: every active ticket either
//      occupies a visible row with its own caption, or is counted in a
//      visible overflow line - and the caption list covers exactly the
//      visible rows, never more and never fewer."
//   2. "The grid's width is a property of the stage set, not of the ticket
//      count: with eight fixed stage columns plus the id gutter, no ticket
//      is ever dropped for width - only the row budget can drop one."
//
// This supersedes the BL-585 property that lived here, which asserted the
// pre-pivot layout (a fixed matrix of header + one row per STAGE, and a
// one-line-per-ticket caption tail). Same intent - width budget plus
// conservation - re-expressed for the layout that now exists.
//
// Generator reach is CONSTRUCTED, not hoped for. Ticket count is drawn
// relative to the real row budget so both the under-budget and over-budget
// sides are reached by construction rather than by luck of a uniform draw,
// and id width and epic membership are drawn as explicit categories. Each
// category's hit count is asserted as a floor at the end - a property that
// never generated an over-budget board would pass against a renderer with
// no budget at all.
const ID_WIDTHS = [3, 4, 5, 6];
const EPIC_MIXES = ['all', 'mixed', 'none'];

const gridCaseArb = fc.record({
  // Relative to the budget: negative is under, zero is exactly at it,
  // positive is over. Both sides guaranteed reachable.
  countOffset: fc.integer({ min: -PIPELINE_BOARD_GRID_MAX_ROWS + 1, max: 8 }),
  idWidth: fc.constantFrom(...ID_WIDTHS),
  epicMix: fc.constantFrom(...EPIC_MIXES),
});

function epicFor(mix, index) {
  if (mix === 'all') {
    return `epic-${index % 3}`;
  }
  if (mix === 'none') {
    return undefined;
  }
  return index % 2 === 0 ? `epic-${index % 3}` : undefined;
}

function buildCase({ countOffset, idWidth, epicMix }) {
  const count = Math.max(1, PIPELINE_BOARD_GRID_MAX_ROWS + countOffset);
  const base = 10 ** (idWidth - 1);
  const ids = Array.from({ length: count }, (_, i) => `BL-${base + i}`);
  const roleHeldTickets = {};
  const ticketMeta = {};
  ids.forEach((id, i) => {
    const role = ALL_SWARM_ROLES[i % ALL_SWARM_ROLES.length];
    (roleHeldTickets[role] ??= []).push(id);
    const epic = epicFor(epicMix, i);
    ticketMeta[id] = { title: `title ${i}`, ...(epic === undefined ? {} : { epic }) };
  });
  return { ids, roleHeldTickets, ticketMeta, count };
}

// Splits a rendered board into its parts. The caption block always opens
// with a blank line and no grid line is ever empty, so the first empty line
// is an unambiguous boundary.
function dissect(text) {
  const lines = text.split('\n');
  const firstBlank = lines.indexOf('');
  const grid = firstBlank === -1 ? lines : lines.slice(0, firstBlank);
  const tail = firstBlank === -1 ? [] : lines.slice(firstBlank + 1);
  const overflow = /^\+(\d+) more active$/.exec(tail[tail.length - 1] ?? '');
  return {
    header: grid[0],
    rows: grid.slice(1),
    separators: tail.filter((l) => l.startsWith('-- ')),
    summaries: tail.filter((l) => l !== '' && !l.startsWith('-- ') && !/^\+\d+ more active$/.test(l)),
    dropped: overflow ? Number(overflow[1]) : 0,
    hasOverflowLine: Boolean(overflow),
  };
}

test('property (BL-979 invariants 1 and 2): every active ticket is a captioned row or a counted drop, and width is fixed by the stage set', () => {
  const reached = { under: 0, over: 0, exact: 0 };
  const reachedWidth = Object.fromEntries(ID_WIDTHS.map((w) => [w, 0]));
  const reachedMix = Object.fromEntries(EPIC_MIXES.map((m) => [m, 0]));

  fc.assert(
    fc.property(gridCaseArb, (spec) => {
      const { ids, roleHeldTickets, ticketMeta, count } = buildCase(spec);
      reachedWidth[spec.idWidth] += 1;
      reachedMix[spec.epicMix] += 1;
      reached[count > PIPELINE_BOARD_GRID_MAX_ROWS ? 'over' : count === PIPELINE_BOARD_GRID_MAX_ROWS ? 'exact' : 'under'] += 1;

      const data = computePipelineBoard(roleHeldTickets, [], ticketMeta, { activeIds: ids });
      const board = dissect(renderPipelineBoardGridOnly(data));

      // ── Invariant 2: width is a property of the stage set ──────────────
      const gutter = Math.max(3, spec.idWidth);
      const expectedWidth = gutter + PIPELINE_BOARD_COLUMN_ORDER.length * 3;
      for (const line of [board.header, ...board.rows]) {
        assert.equal(line.length, expectedWidth, `grid line "${line}" is not the stage-set width`);
        assert.ok(line.length <= PIPELINE_BOARD_GRID_MAX_WIDTH, `"${line}" exceeds the ${PIPELINE_BOARD_GRID_MAX_WIDTH}-char budget`);
      }
      // No ticket is EVER dropped for width: whatever was dropped is
      // explained entirely by the row budget.
      const expectedVisible = Math.min(count, PIPELINE_BOARD_GRID_MAX_ROWS);
      assert.equal(board.rows.length, expectedVisible, 'only the row budget may drop a row');

      // ── Invariant 1: nothing vanishes, captions match the visible rows ──
      assert.equal(board.rows.length + board.dropped, count, 'visible + dropped accounts for every active ticket');
      assert.equal(board.hasOverflowLine, count > PIPELINE_BOARD_GRID_MAX_ROWS, 'the overflow line appears exactly when rows were dropped');
      assert.equal(board.summaries.length, board.rows.length, 'the caption list covers exactly the visible rows - never more, never fewer');

      // Same tickets, same order, in both halves.
      const rowIds = board.rows.map((l) => l.trimStart().split('\u00a0')[0]);
      const captionIds = board.summaries.map((l) => l.split(' ')[0]);
      assert.deepEqual(captionIds, rowIds, 'each visible row has its OWN caption, in the same order');

      // A separator is emitted iff some visible ticket carries an epic.
      const anyEpic = board.summaries.some((_, i) => ticketMeta[ids[i]].epic !== undefined);
      assert.equal(board.separators.length > 0, anyEpic, 'separators appear exactly when the board has an epic');
    }),
    { numRuns: 300 }
  );

  assert.ok(reached.over >= 30, `reachability floor: over-budget boards generated only ${reached.over} times`);
  assert.ok(reached.under >= 30, `reachability floor: under-budget boards generated only ${reached.under} times`);
  for (const [w, n] of Object.entries(reachedWidth)) {
    assert.ok(n >= 30, `reachability floor: ${w}-digit ids generated only ${n} times`);
  }
  for (const [m, n] of Object.entries(reachedMix)) {
    assert.ok(n >= 30, `reachability floor: epic mix "${m}" generated only ${n} times`);
  }
});
