const assert = require('node:assert/strict');
const test = require('node:test');

const { renderPanel } = require('./helpers/renderPanel');

// BL-072's hard requirement: at least one test must assert on the rendered
// BACKLOG row HTML (browser-visible markup), not only on resolver state.
// These render the REAL webview shell + REAL media/panel.js in jsdom and
// dispatch backlogUpdate/holderUpdate exactly as swarmPanel.ts would.
//
// Root cause (confirmed, not assumed): the ticket's own note pointed at
// webviewHtml.ts:84, but that line belongs to getWorkTreeHtml — a
// completely separate panel (SwarmForge: Show Work Tree), not the BACKLOG
// pane described in these acceptance scenarios. The actual bug is in
// media/panel.js's backlogRowHtml: when no live holder resolves for an
// active item, it fell back to the static assignedTo YAML field — exactly
// the misleading display reported for promoted-but-unrouted tickets.

function backlogRow(document, id) {
  const rows = [...document.querySelectorAll('.backlog-row')];
  return rows.find((r) => r.querySelector('.bl-id').textContent === id);
}

// The row's title and assignee spans are concatenated with no separator in
// textContent (e.g. "...chasecoder"), which defeats \b-anchored regexes
// against the whole row — read the .bl-assigned span alone instead.
function backlogRowAssignee(document, id) {
  const row = backlogRow(document, id);
  const assigned = row && row.querySelector('.bl-assigned');
  return assigned ? assigned.textContent : null;
}

function dispatchBacklogState(dispatch, items, holders) {
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders });
}

// BL-072 live-backlog-holder-01
test('a routed parcel row shows the live holder, not the YAML assignedTo when they differ', () => {
  const { document, dispatch } = renderPanel();
  const items = [
    { id: 'BL-201', title: 'routed to cleaner', status: 'active', assignedTo: 'coder' },
    { id: 'BL-202', title: 'routed to QA', status: 'active', assignedTo: 'coder' },
  ];
  dispatchBacklogState(dispatch, items, { 'BL-201': 'cleaner', 'BL-202': 'QA' });

  assert.equal(backlogRowAssignee(document, 'BL-201'), 'cleaner');
  assert.equal(backlogRowAssignee(document, 'BL-202'), 'QA');
});

// BL-072 live-backlog-holder-02
test('the row follows the parcel when it is handed to the next role and the panel refreshes', () => {
  const { document, dispatch } = renderPanel();
  const items = [{ id: 'BL-067', title: 'stuck-in-process chase', status: 'active', assignedTo: 'coder' }];

  dispatchBacklogState(dispatch, items, { 'BL-067': 'coder' });
  assert.equal(backlogRowAssignee(document, 'BL-067'), 'coder');

  dispatchBacklogState(dispatch, items, { 'BL-067': 'cleaner' });
  assert.equal(backlogRowAssignee(document, 'BL-067'), 'cleaner');
});

// The second, compounding bug this commit fixed: holderMap must be REPLACED
// each poll, not merged, or a ticket that loses its live holder (e.g. its
// parcel lands and the item briefly has no routed inbox holder before the
// next stage picks it up) keeps showing whoever held it last instead of
// "queued". None of the other scenarios exercise a holder disappearing.
test('a row reverts to "queued" when its ticket drops out of the holders payload entirely', () => {
  const { document, dispatch } = renderPanel();
  const items = [
    { id: 'BL-067', title: 'stuck-in-process chase', status: 'active', assignedTo: 'coder' },
    { id: 'BL-069', title: 'graceful bounce', status: 'active', assignedTo: 'coder' },
  ];

  dispatchBacklogState(dispatch, items, { 'BL-067': 'cleaner', 'BL-069': 'architect' });
  assert.equal(backlogRowAssignee(document, 'BL-067'), 'cleaner');
  assert.equal(backlogRowAssignee(document, 'BL-069'), 'architect');

  // Next poll: BL-067 is no longer held by anyone (its stage inbox is
  // empty); BL-069 is unaffected. The payload omits BL-067 entirely rather
  // than sending an explicit null.
  dispatchBacklogState(dispatch, items, { 'BL-069': 'architect' });

  assert.equal(
    backlogRowAssignee(document, 'BL-067'),
    'queued',
    'a ticket dropped from the holders payload must revert to queued, not keep showing the stale prior holder'
  );
  assert.equal(backlogRowAssignee(document, 'BL-069'), 'architect', 'an unaffected ticket keeps its holder');
});

// BL-072 live-backlog-holder-03
test('a promoted but unrouted ticket shows "queued", not the assignee', () => {
  const { document, dispatch } = renderPanel();
  const items = [{ id: 'BL-069', title: 'graceful bounce', status: 'active', assignedTo: 'coder' }];

  // no stage inbox holds a parcel for this ticket: the host never includes
  // it in the holders map at all
  dispatchBacklogState(dispatch, items, {});

  assert.equal(backlogRowAssignee(document, 'BL-069'), 'queued');
});

// BL-072 live-backlog-holder-04
test('the reported 2026-07-02 state renders truthfully: one cleaner, two queued, none coder', () => {
  const { document, dispatch } = renderPanel();
  const items = [
    { id: 'BL-067', title: 'held by cleaner', status: 'active', assignedTo: 'coder' },
    { id: 'BL-069', title: 'promoted, not routed', status: 'active', assignedTo: 'coder' },
    { id: 'BL-063', title: 'promoted, not routed', status: 'active', assignedTo: 'coder' },
  ];
  dispatchBacklogState(dispatch, items, { 'BL-067': 'cleaner' });

  assert.equal(backlogRowAssignee(document, 'BL-067'), 'cleaner');
  assert.equal(backlogRowAssignee(document, 'BL-069'), 'queued');
  assert.equal(backlogRowAssignee(document, 'BL-063'), 'queued');

  const allAssignees = [...document.querySelectorAll('.bl-assigned')].map((el) => el.textContent);
  assert.ok(!allAssignees.includes('coder'), 'no row may show the static assignee "coder"');
});

// BL-072 live-backlog-holder-05
test('the tile badge holder and the backlog row holder agree in the same render', () => {
  const { document, dispatch } = renderPanel();
  dispatch({
    type: 'roles',
    roles: [
      { role: 'coder', displayName: 'Coder', agent: 'claude' },
      { role: 'cleaner', displayName: 'Cleaner', agent: 'claude' },
    ],
  });

  const items = [{ id: 'BL-067', title: 'stuck-in-process chase', status: 'active', assignedTo: 'coder' }];
  dispatchBacklogState(dispatch, items, { 'BL-067': 'cleaner' });
  // Same resolution the host already computed for holderUpdate above (BL-067
  // resolves to cleaner) is what feeds the tile badge too, in the same poll.
  dispatch({ type: 'badgeUpdate', badges: { cleaner: { id: 'BL-067', summary: 'stuck-in-process chase', holder: 'cleaner' } } });

  const tileBadge = document.querySelector('.tile[data-role="cleaner"] .tile-bl-badge').textContent;
  assert.match(tileBadge, /BL-067/);
  assert.equal(backlogRowAssignee(document, 'BL-067'), 'cleaner');
});
