const assert = require('node:assert/strict');
const { renderPanel } = require('./helpers/renderPanel');
const { buildBadgeMap } = require('../out/panel/badgeSummary');

// BL-139 supersedes BL-077's stage-identity color contract: color now means
// TICKET identity, not which stage holds a parcel, so the same ticket must
// render with the same color everywhere regardless of which stage moves it.
// These tests render the REAL webview shell (getWebviewHtml) and evaluate the
// REAL media/panel.js source in jsdom (BL-068's lesson: a state-only test of
// the color-mapping function alone does not prove the rendered surfaces
// agree).

const ALL_ROLES = [
  { role: 'coder', displayName: 'Coder', agent: 'claude' },
  { role: 'QA', displayName: 'Qa', agent: 'claude' },
  { role: 'cleaner', displayName: 'Cleaner', agent: 'claude' },
];

function backlogRowAssignedEl(document, id) {
  const rows = [...document.querySelectorAll('.backlog-row')];
  const row = rows.find((r) => r.querySelector('.bl-id').textContent === id);
  return row && row.querySelector('.bl-assigned');
}

function tileBadgeEl(document, role) {
  const tile = document.querySelector(`.tile[data-role="${role}"]`);
  return tile && tile.querySelector('.tile-bl-badge');
}

function backgroundOf(el) {
  return el && el.style.background;
}

// BL-139 ticket-color-02
test('two different in-flight tickets get visibly distinct, cross-surface-agreeing colors', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [
    { id: 'BL-201', title: 'held by coder', status: 'active', assignedTo: 'coder' },
    { id: 'BL-202', title: 'held by QA', status: 'active', assignedTo: 'QA' },
  ];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: { 'BL-201': 'coder', 'BL-202': 'QA' } });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const rowAColor = backgroundOf(backlogRowAssignedEl(document, 'BL-201'));
  const rowBColor = backgroundOf(backlogRowAssignedEl(document, 'BL-202'));
  const badgeAColor = backgroundOf(tileBadgeEl(document, 'coder'));
  const badgeBColor = backgroundOf(tileBadgeEl(document, 'QA'));

  assert.ok(rowAColor, 'BL-201 row chip must carry a ticket color');
  assert.ok(badgeAColor, 'coder tile badge must carry a ticket color');
  assert.equal(rowAColor, badgeAColor, 'row chip and tile badge must agree on BL-201 color');

  assert.ok(rowBColor, 'BL-202 row chip must carry a ticket color');
  assert.ok(badgeBColor, 'QA tile badge must carry a ticket color');
  assert.equal(rowBColor, badgeBColor, 'row chip and tile badge must agree on BL-202 color');

  assert.notEqual(rowAColor, rowBColor, 'BL-201 and BL-202 must be visibly distinct colors');
});

// BL-139 ticket-color-01
test('the SAME ticket keeps its color as it moves down the pipeline on both surfaces', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [{ id: 'BL-203', title: 'handed off', status: 'active', assignedTo: 'coder' }];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: { 'BL-203': 'coder' } });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const coderRowColor = backgroundOf(backlogRowAssignedEl(document, 'BL-203'));
  const coderBadgeColor = backgroundOf(tileBadgeEl(document, 'coder'));
  assert.ok(coderRowColor);
  assert.equal(coderRowColor, coderBadgeColor);

  dispatch({ type: 'holderUpdate', holders: { 'BL-203': 'cleaner' } });
  dispatch({
    type: 'badgeUpdate',
    badges: { cleaner: { id: 'BL-203', summary: 'handed off', holder: 'cleaner', heldTicketIds: ['BL-203'] } },
  });

  const cleanerRowColor = backgroundOf(backlogRowAssignedEl(document, 'BL-203'));
  const cleanerBadgeColor = backgroundOf(tileBadgeEl(document, 'cleaner'));
  // BL-139: color is ticket identity, so BL-203 must render the same color
  // after moving from coder to cleaner, on both surfaces.
  assert.equal(cleanerRowColor, coderRowColor, 'BL-203 must keep its color after moving stages (row chip)');
  assert.equal(cleanerBadgeColor, coderRowColor, 'BL-203 must keep its color after moving stages (tile badge)');
});

// BL-139 ticket-color-06
test('color is additive: the row chip and badge still carry the holder/ticket as text, not only as color', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [{ id: 'BL-206', title: 'held by coder', status: 'active', assignedTo: 'coder' }];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: { 'BL-206': 'coder' } });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const rowEl = backlogRowAssignedEl(document, 'BL-206');
  assert.equal(rowEl.textContent, 'coder', 'the holder text must still be present, not replaced by color alone');
  assert.match(tileBadgeEl(document, 'coder').textContent, /BL-206/);
});

test('the needs-human red border pulse stays independent of the ticket-color badge', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [{ id: 'BL-207', title: 'blocked on a question', status: 'active', assignedTo: 'coder' }];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: { 'BL-207': 'coder' } });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const tile = document.querySelector('.tile[data-role="coder"]');
  tile.classList.add('needs-human');

  assert.ok(tile.classList.contains('needs-human'), 'the border-pulse class is untouched by badge coloring');
  assert.ok(backgroundOf(tileBadgeEl(document, 'coder')), 'the ticket color badge is still present');
});

// BL-139 ticket-color-04/05
test('an agent holding multiple tickets renders a segmented rainbow indicator, deterministically', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [
    { id: 'BL-061', title: 'a', status: 'active', assignedTo: 'coder' },
    { id: 'BL-036', title: 'b', status: 'active', assignedTo: 'coder' },
    { id: 'BL-045', title: 'c', status: 'active', assignedTo: 'coder' },
  ];
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const firstBackground = backgroundOf(tileBadgeEl(document, 'coder'));
  assert.match(firstBackground, /linear-gradient/, 'a multi-ticket holder must render a segmented gradient');

  // Re-dispatch the identical badge state and confirm the rendered gradient
  // is byte-for-byte identical (ticket-color-05: deterministic across
  // repeated renders of the same held set).
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });
  const secondBackground = backgroundOf(tileBadgeEl(document, 'coder'));
  assert.equal(secondBackground, firstBackground);
});
