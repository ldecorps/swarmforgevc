'use strict';

// BL-1045: the board surfaces backlog/hold/.
//
// backlogReader.ts has returned `hold` since BL-672 and findBacklogItem
// already searches it; the board's own `location` union simply never learned
// the state exists, so held tickets fell off it entirely. Three were invisible
// when this was written - two for twelve days, and a severity-high defect
// parked that morning by a park that was itself correct.
//
// Two invariants are enforced here rather than by review:
//   - a held ticket is never rendered as in-flight: not in a role column, not
//     in the not-started column, because no role holds it;
//   - the board is at least as complete as the folders its reader returns:
//     every held ticket appears, or the board states how many it left out.

const assert = require('node:assert/strict');

const {
  PIPELINE_BOARD_HELD_MAX,
  PIPELINE_BOARD_NOT_STARTED_COLUMN,
  computePipelineBoard,
  formatHeldForLabel,
  renderPipelineBoardBody,
} = require('../out/concierge/pipelineBoard');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);

function heldItem(id, days, extra = {}) {
  return {
    id,
    title: `${id} title`,
    filename: `${id}-thing.yaml`,
    heldSinceMs: NOW - days * DAY_MS,
    ...extra,
  };
}

function board(extras = {}) {
  return computePipelineBoard({}, [], {}, { nowMs: NOW, ...extras });
}

// ── formatHeldForLabel (pure, injected clock) ─────────────────────────────

test('a held age reads in the unit that makes twelve days and yesterday differ at a glance', () => {
  assert.equal(formatHeldForLabel(NOW - 12 * DAY_MS, NOW), '12d');
  assert.equal(formatHeldForLabel(NOW - 1 * DAY_MS, NOW), '1d');
  assert.equal(formatHeldForLabel(NOW - 5 * 60 * 60 * 1000, NOW), '5h');
  assert.equal(formatHeldForLabel(NOW - 90 * 1000, NOW), '1m');
  assert.equal(formatHeldForLabel(NOW - 1000, NOW), 'just now');
});

test('an unknown or future hold date is stated as unknown, never as zero', () => {
  assert.equal(formatHeldForLabel(undefined, NOW), 'age unknown');
  assert.equal(formatHeldForLabel(NOW + DAY_MS, NOW), 'just now');
});

test('exactly one hour and exactly one minute are the boundaries themselves, not one tick short', () => {
  assert.equal(formatHeldForLabel(NOW - 60 * 60 * 1000, NOW), '1h');
  assert.equal(formatHeldForLabel(NOW - 60 * 1000, NOW), '1m');
});

// ── the-board-surfaces-held-tickets-01 ────────────────────────────────────

test('a held ticket appears in its own section with its id and how long it has been held', () => {
  const data = board({ held: [heldItem('BL-844', 12)] });
  assert.equal(data.held.length, 1);
  assert.equal(data.held[0].id, 'BL-844');
  assert.equal(data.held[0].heldFor, '12d');

  const body = renderPipelineBoardBody(data);
  assert.match(body, /^HELD:$/m);
  // The board's own short-id convention (deriveDisplayTicketId), the same one
  // every other below-grid section uses - not a second id format here.
  assert.match(body, /^ {2}844 /m);
  assert.match(body, /\(12d\)/);
});

test('held tickets are listed longest-held first, because duration is the harm', () => {
  const data = board({ held: [heldItem('BL-1043', 1), heldItem('BL-844', 12), heldItem('BL-845', 12)] });
  assert.deepEqual(data.held.map((h) => h.id), ['BL-844', 'BL-845', 'BL-1043']);
});

test('a tie in held duration breaks by id, not by whatever order the caller happened to supply', () => {
  // Input order is deliberately the REVERSE of id order - if the tie-break
  // were ever skipped (e.g. treating equal ages as "no comparison needed"),
  // Array.sort would just preserve this input order instead of re-sorting
  // by id, and this would still pass by accident with matching input order.
  const data = board({ held: [heldItem('BL-845', 12), heldItem('BL-844', 12)] });
  assert.deepEqual(data.held.map((h) => h.id), ['BL-844', 'BL-845']);
});

// ── the-board-surfaces-held-tickets-02 ────────────────────────────────────

test('a held ticket appears in no role column and not in the not-started column', () => {
  const data = computePipelineBoard(
    { coder: ['BL-999'] },
    [],
    {},
    { nowMs: NOW, held: [heldItem('BL-844', 12)], activeIds: ['BL-999', 'BL-844'] }
  );
  assert.deepEqual(data.rows.map((r) => r.id), ['BL-999']);
  assert.ok(!data.rows.some((r) => r.id === 'BL-844'), 'a held ticket must never be a grid row');
  assert.ok(
    !data.rows.some((r) => r.column === PIPELINE_BOARD_NOT_STARTED_COLUMN && r.id === 'BL-844'),
    'no role holds a held ticket, so it is not merely not-started'
  );
});

test('a ticket that is somehow both role-held and in hold/ is shown as held, not in flight', () => {
  const data = computePipelineBoard(
    { coder: ['BL-844'] },
    [],
    {},
    { nowMs: NOW, held: [heldItem('BL-844', 12)], activeIds: ['BL-844'] }
  );
  assert.deepEqual(data.rows, []);
  assert.equal(data.held.length, 1);
});

test('a held ticket is not rendered as parked either', () => {
  const data = board({ held: [heldItem('BL-844', 12)] });
  assert.deepEqual(data.parked, []);
  const body = renderPipelineBoardBody(data);
  assert.ok(!/^PARKED:$/m.test(body), 'hold is its own state, not a flavour of paused');
});

// ── the-board-surfaces-held-tickets-03 ────────────────────────────────────

test('a held section over its cap says how many it left out', () => {
  const many = Array.from({ length: PIPELINE_BOARD_HELD_MAX + 3 }, (_, i) => heldItem(`BL-${900 + i}`, i + 1));
  const data = board({ held: many });
  assert.equal(data.held.length, PIPELINE_BOARD_HELD_MAX);
  assert.equal(data.heldOmittedCount, 3);
  assert.match(renderPipelineBoardBody(data), /\+3 more held/);
});

test('a held section inside its cap says nothing about omissions', () => {
  const data = board({ held: [heldItem('BL-844', 12)] });
  assert.equal(data.heldOmittedCount, undefined);
  assert.ok(!/more held/.test(renderPipelineBoardBody(data)));
});

test('the cap drops the SHORTEST-held first, so the twelve-day ticket is never the one hidden', () => {
  const many = Array.from({ length: PIPELINE_BOARD_HELD_MAX + 1 }, (_, i) => heldItem(`BL-${900 + i}`, i + 1));
  const data = board({ held: many });
  assert.ok(data.held.some((h) => h.id === `BL-${900 + PIPELINE_BOARD_HELD_MAX}`), 'the oldest must survive the cap');
  assert.ok(!data.held.some((h) => h.id === 'BL-900'), 'the newest is the one dropped');
});

// ── the-board-surfaces-held-tickets-05 ────────────────────────────────────

test('no held tickets renders no held section frame at all', () => {
  const body = renderPipelineBoardBody(board({ held: [] }));
  assert.ok(!/HELD:/.test(body));
});

test('the rest of the board is byte-identical when nothing is held', () => {
  const withoutHeldInput = renderPipelineBoardBody(computePipelineBoard({ coder: ['BL-999'] }, [], {}, {}));
  const withEmptyHeld = renderPipelineBoardBody(
    computePipelineBoard({ coder: ['BL-999'] }, [], {}, { nowMs: NOW, held: [] })
  );
  assert.equal(withEmptyHeld, withoutHeldInput);
});

// ── links ─────────────────────────────────────────────────────────────────

test('a held ticket links into backlog/hold/, the folder it is actually in', () => {
  const data = computePipelineBoard(
    {},
    [],
    { 'BL-844': { filename: 'BL-844-thing.yaml', location: 'hold' } },
    { nowMs: NOW, held: [heldItem('BL-844', 12)], repoBaseUrl: 'https://github.com/x/y' }
  );
  const link = data.links.find((l) => l.id === 'BL-844');
  assert.ok(link, 'a held ticket must be reachable from the link list');
  assert.equal(link.path, 'backlog/hold/BL-844-thing.yaml');
});

test('no held tickets at all (the extras field itself absent, not just empty) links nothing bogus', () => {
  const data = computePipelineBoard({}, [], {}, { nowMs: NOW, repoBaseUrl: 'https://github.com/x/y' });
  assert.ok(!data.links.some((l) => l.id === undefined), 'the fallback default must never itself become a fake link entry');
});

test('a held ticket with no filename to link is left out of the link list, not linked with a broken path', () => {
  const data = computePipelineBoard(
    {},
    [],
    {},
    {
      nowMs: NOW,
      held: [{ id: 'BL-1', title: 'x', filename: '', heldSinceMs: NOW - DAY_MS }],
      repoBaseUrl: 'https://github.com/x/y',
    }
  );
  assert.ok(!data.links.some((l) => l.id === 'BL-1'), 'an unresolvable path must never become a broken link entry');
});

test('a link already found from an earlier source keeps its FIRST path when the same id also appears held', () => {
  const data = computePipelineBoard(
    {},
    [],
    { 'BL-1': { filename: 'BL-1-thing.yaml', location: 'root' } },
    {
      nowMs: NOW,
      rootIntake: [{ id: 'BL-1', title: 'x' }],
      held: [{ id: 'BL-1', title: 'x', filename: 'BL-1-thing.yaml', heldSinceMs: NOW - DAY_MS }],
      repoBaseUrl: 'https://github.com/x/y',
    }
  );
  const link = data.links.find((l) => l.id === 'BL-1');
  assert.equal(link.path, 'backlog/BL-1-thing.yaml', 'root-intake is found first in the link sources; it must win, not the later held entry');
});

// ── rendering ─────────────────────────────────────────────────────────────

test('the held section is preceded by a genuinely blank line, not some other separator text', () => {
  const data = board({ held: [heldItem('BL-844', 12)] });
  const lines = renderPipelineBoardBody(data).split('\n');
  const headerIndex = lines.indexOf('HELD:');
  assert.ok(headerIndex > 0, 'the header must actually be present');
  assert.equal(lines[headerIndex - 1], '', 'the line right before HELD: must be empty, not placeholder text');
});

test('an item with no title collapses the double space before the parenthesis to one', () => {
  const data = computePipelineBoard(
    {},
    [],
    {},
    { nowMs: NOW, held: [{ id: 'BL-1', title: '', filename: 'x.yaml', heldSinceMs: NOW - DAY_MS }] }
  );
  assert.match(renderPipelineBoardBody(data), /^ {2}1 \(1d\)$/m);
});
