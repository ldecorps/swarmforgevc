const assert = require('node:assert/strict');
const test = require('node:test');

const { renderPanel } = require('./helpers/renderPanel');
const { buildBadgeMap } = require('../out/panel/badgeSummary');

// BL-068's hard requirement: a state-only unit test (badgeSummary.test.js)
// is not sufficient to close this ticket. These tests render the REAL
// webview HTML shell (getWebviewHtml) and evaluate the REAL media/panel.js
// source in jsdom, then assert on the rendered tile-header markup a browser
// would actually show — pinning the surface where the reported regression
// (bare "Hardender hardender" headers with parcels demonstrably in flight)
// actually broke, not just the state that feeds it.

const ALL_ROLES = [
  { role: 'coordinator', displayName: 'Coordinator', agent: 'claude' },
  { role: 'specifier', displayName: 'Specifier', agent: 'claude' },
  { role: 'coder', displayName: 'Coder', agent: 'claude' },
  { role: 'cleaner', displayName: 'Cleaner', agent: 'claude' },
  { role: 'architect', displayName: 'Architect', agent: 'claude' },
  { role: 'hardender', displayName: 'Hardender', agent: 'claude' },
  { role: 'documenter', displayName: 'Documenter', agent: 'claude' },
  { role: 'QA', displayName: 'Qa', agent: 'claude' },
];

function tileHeaderText(document, role) {
  const tile = document.querySelector(`.tile[data-role="${role}"]`);
  return tile.querySelector('.tile-header').textContent;
}

function badgeText(document, role) {
  const tile = document.querySelector(`.tile[data-role="${role}"]`);
  return tile.querySelector('.tile-bl-badge').textContent;
}

// BL-068 rendered-header-badge-01
test('the holding role rendered header shows the badge; a non-holder shows only its role name', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const badges = buildBadgeMap(
    [{ id: 'BL-068', title: 'tile headers show no ticket IDs', status: 'active', assignedTo: 'coder' }]
  );
  dispatch({ type: 'badgeUpdate', badges });

  assert.match(tileHeaderText(document, 'coder'), /BL-068/, 'the holding tile must show the badge in its rendered header');
  const cleanerHeader = tileHeaderText(document, 'cleaner');
  assert.doesNotMatch(cleanerHeader, /BL-/, 'a non-holding tile must not show any ticket badge');
  assert.match(cleanerHeader, /Cleaner/, 'a non-holding tile still shows its role name');
});

// BL-068 rendered-header-badge-02
test('the badge moves to the next role when the parcel is handed off, and clears from the previous holder', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  dispatch({
    type: 'badgeUpdate',
    badges: buildBadgeMap([{ id: 'BL-068', title: 'badge handoff', status: 'active', assignedTo: 'coder' }]),
  });
  assert.match(badgeText(document, 'coder'), /BL-068/);

  // the parcel is handed to cleaner; swarmPanel.ts's next poll resolves
  // findLiveHolder to the new stage and the badges map is now keyed on it
  dispatch({
    type: 'badgeUpdate',
    badges: { cleaner: { id: 'BL-068', summary: 'badge handoff', holder: 'cleaner' } },
  });

  assert.match(badgeText(document, 'cleaner'), /BL-068/, 'the next role now shows the badge');
  assert.equal(badgeText(document, 'coder'), '', 'the previous holder no longer shows it');
});

// BL-068 rendered-header-badge-03
test('the reported screenshot state renders a badge on every holding tile, none bare', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  // Mirrors the recorded 2026-07-02 state: several parcels held at several
  // stages simultaneously (hardener batch on BL-036/BL-061, documenter on a
  // defect, QA on a batch).
  const items = [
    { id: 'BL-036', title: 'redo_from tool', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-061', title: 'handoffd deadlock', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-057', title: 'redo tag defect', status: 'active', assignedTo: 'documenter' },
    { id: 'BL-060', title: 'batch item', status: 'active', assignedTo: 'QA' },
  ];
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  for (const role of ['hardender', 'documenter', 'QA']) {
    assert.match(
      tileHeaderText(document, role),
      /BL-\d+/,
      `${role} holds a parcel and must show a badge, not a bare role-name header`
    );
  }
  // an idle role in the same render shows no badge
  assert.doesNotMatch(tileHeaderText(document, 'cleaner'), /BL-\d+/);
});

// BL-068 rendered-header-badge-04
test('a role holding multiple parcels renders the lowest ID badge plus a +N count', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [
    { id: 'BL-061', title: 'handoffd deadlock', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-036', title: 'redo_from tool', status: 'active', assignedTo: 'hardender' },
  ];
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const text = badgeText(document, 'hardender');
  assert.match(text, /BL-036/, 'the lowest ticket ID is the primary badge');
  assert.match(text, /\+1/, 'the remaining held parcel is shown as a count, not dropped');
});

test('a role holding three parcels renders the lowest ID badge plus +2', () => {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: ALL_ROLES });

  const items = [
    { id: 'BL-062', title: 'done milestone reader', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-059', title: 'needs-human blink red', status: 'active', assignedTo: 'hardender' },
    { id: 'BL-060', title: 'suite speed fix', status: 'active', assignedTo: 'hardender' },
  ];
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items) });

  const text = badgeText(document, 'hardender');
  assert.match(text, /BL-059/);
  assert.match(text, /\+2/);
});
