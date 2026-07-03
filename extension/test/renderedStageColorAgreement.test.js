const assert = require('node:assert/strict');
const test = require('node:test');

const { renderPanel } = require('./helpers/renderPanel');
const { buildBadgeMap } = require('../out/panel/badgeSummary');

// BL-077: the tile-header badge (.tile-bl-badge) and the BACKLOG row chip
// (.bl-assigned) must render the SAME stage-color-* class for a given
// holder, on the same refresh, and that class must differ across stages and
// for the neutral queued/done states. These render the REAL webview shell +
// REAL media/panel.js in jsdom (BL-068/BL-072's lesson: a state-only test of
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

function stageColorClassOf(el) {
  return el && [...el.classList].find((c) => c.startsWith('stage-color-'));
}

// BL-077 stage-colors-01 / stage-colors-05
test('two in-flight tickets at different stages get visibly distinct, cross-surface-agreeing colors', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [
    { id: 'BL-201', title: 'held by coder', status: 'active', assignedTo: 'coder' },
    { id: 'BL-202', title: 'held by QA', status: 'active', assignedTo: 'QA' },
  ];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: { 'BL-201': 'coder', 'BL-202': 'QA' } });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const rowAColor = stageColorClassOf(backlogRowAssignedEl(document, 'BL-201'));
  const rowBColor = stageColorClassOf(backlogRowAssignedEl(document, 'BL-202'));
  const badgeAColor = stageColorClassOf(tileBadgeEl(document, 'coder'));
  const badgeBColor = stageColorClassOf(tileBadgeEl(document, 'QA'));

  assert.ok(rowAColor, 'BL-201 row chip must carry a stage color class');
  assert.ok(badgeAColor, 'coder tile badge must carry a stage color class');
  assert.equal(rowAColor, badgeAColor, 'row chip and tile badge must agree on BL-201 color');

  assert.ok(rowBColor, 'BL-202 row chip must carry a stage color class');
  assert.ok(badgeBColor, 'QA tile badge must carry a stage color class');
  assert.equal(rowBColor, badgeBColor, 'row chip and tile badge must agree on BL-202 color');

  assert.notEqual(rowAColor, rowBColor, 'coder and QA stages must be visibly distinct colors');
});

// BL-077 stage-colors-02
test('the color follows the parcel down the pipeline on both surfaces', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [{ id: 'BL-203', title: 'handed off', status: 'active', assignedTo: 'coder' }];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: { 'BL-203': 'coder' } });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const coderRowColor = stageColorClassOf(backlogRowAssignedEl(document, 'BL-203'));
  const coderBadgeColor = stageColorClassOf(tileBadgeEl(document, 'coder'));
  assert.equal(coderRowColor, 'stage-color-coder');
  assert.equal(coderBadgeColor, 'stage-color-coder');

  dispatch({ type: 'holderUpdate', holders: { 'BL-203': 'cleaner' } });
  dispatch({
    type: 'badgeUpdate',
    badges: { cleaner: { id: 'BL-203', summary: 'handed off', holder: 'cleaner' } },
  });

  const cleanerRowColor = stageColorClassOf(backlogRowAssignedEl(document, 'BL-203'));
  const cleanerBadgeColor = stageColorClassOf(tileBadgeEl(document, 'cleaner'));
  assert.equal(cleanerRowColor, 'stage-color-cleaner');
  assert.equal(cleanerBadgeColor, 'stage-color-cleaner');
});

// BL-077 stage-colors-03
test('queued and done tickets get neutral colors distinct from every stage', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [
    { id: 'BL-204', title: 'promoted, not yet routed', status: 'active', assignedTo: 'coder' },
    { id: 'BL-205', title: 'closed', status: 'done', milestone: 'M3' },
  ];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: {} });
  dispatch({ type: 'badgeUpdate', badges: {} });

  assert.equal(stageColorClassOf(backlogRowAssignedEl(document, 'BL-204')), 'stage-color-queued');
  const doneEl = document.querySelector('.bl-milestone');
  assert.equal(stageColorClassOf(doneEl), 'stage-color-done');
});

// BL-077 stage-colors-04
test('color is additive: the row chip and badge still carry the holder as text, not only as color', () => {
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

// BL-077 stage-colors-06
test('the needs-human red border pulse stays independent of the stage-color badge class', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [{ id: 'BL-207', title: 'blocked on a question', status: 'active', assignedTo: 'coder' }];
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: { 'BL-207': 'coder' } });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const tile = document.querySelector('.tile[data-role="coder"]');
  tile.classList.add('needs-human');

  assert.ok(tile.classList.contains('needs-human'), 'the border-pulse class is untouched by badge coloring');
  assert.equal(stageColorClassOf(tileBadgeEl(document, 'coder')), 'stage-color-coder');
});
