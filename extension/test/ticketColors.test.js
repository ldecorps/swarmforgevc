const assert = require('node:assert/strict');

const { PALETTE, ticketColorFor, ticketColorSegments } = require('../out/panel/ticketColors');

// --- ticketColorFor (BL-139 ticket-color-01/03) ---

test('ticketColorFor returns the same color for the same ticket id on repeated calls', () => {
  const first = ticketColorFor('BL-139');
  const second = ticketColorFor('BL-139');
  assert.deepEqual(first, second);
});

test('ticketColorFor returns a color from the palette', () => {
  const color = ticketColorFor('BL-042');
  assert.ok(PALETTE.some((entry) => entry.background === color.background && entry.color === color.color));
});

test('ticketColorFor returns a background and a readable text color', () => {
  const color = ticketColorFor('BL-001');
  assert.ok(typeof color.background === 'string' && color.background.length > 0);
  assert.ok(typeof color.color === 'string' && color.color.length > 0);
});

test('ticketColorFor is stable regardless of what other tickets exist (BL-139 ticket-color-01)', () => {
  // Color is a pure function of the ticket id alone, not of position in some
  // currently-visible set — so a ticket keeps its color as other tickets
  // come and go around it across stage transitions.
  const aloneColor = ticketColorFor('BL-200');
  ticketColorFor('BL-001');
  ticketColorFor('BL-999');
  const stillColor = ticketColorFor('BL-200');
  assert.deepEqual(aloneColor, stillColor);
});

test('ticketColorFor gives different-looking ids different colors most of the time', () => {
  // Not a strict guarantee (palette is finite) but a basic smoke check that
  // the hash actually spreads ids across the palette rather than collapsing
  // everything onto one entry.
  const ids = ['BL-001', 'BL-002', 'BL-003', 'BL-004', 'BL-005', 'BL-006'];
  const colors = new Set(ids.map((id) => ticketColorFor(id).background));
  assert.ok(colors.size > 1, 'expected more than one distinct color across 6 different ticket ids');
});

// --- ticketColorSegments (BL-139 ticket-color-04/05) ---

test('ticketColorSegments returns one segment per held ticket, in numeric id order', () => {
  const segments = ticketColorSegments(['BL-100', 'BL-9', 'BL-30']);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((s) => s.id), ['BL-9', 'BL-30', 'BL-100']);
});

test('ticketColorSegments assigns each segment the same color ticketColorFor would for that id', () => {
  const segments = ticketColorSegments(['BL-7', 'BL-8']);
  assert.deepEqual(segments[0].color, ticketColorFor('BL-7'));
  assert.deepEqual(segments[1].color, ticketColorFor('BL-8'));
});

test('ticketColorSegments dedupes repeated ids', () => {
  const segments = ticketColorSegments(['BL-1', 'BL-1', 'BL-2']);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((s) => s.id), ['BL-1', 'BL-2']);
});

test('ticketColorSegments is deterministic across repeated calls on the same set (BL-139 ticket-color-05)', () => {
  const ids = ['BL-3', 'BL-1', 'BL-2'];
  const first = ticketColorSegments(ids);
  const second = ticketColorSegments([...ids]);
  assert.deepEqual(first, second);
});

test('ticketColorSegments handles a single ticket', () => {
  const segments = ticketColorSegments(['BL-5']);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].id, 'BL-5');
});

test('ticketColorSegments handles an empty list', () => {
  const segments = ticketColorSegments([]);
  assert.deepEqual(segments, []);
});
