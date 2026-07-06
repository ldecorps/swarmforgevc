const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderPanel } = require('./helpers/renderPanel');
const { buildBadgeMap } = require('../out/panel/badgeSummary');
const { findLiveHolder } = require('../out/swarm/swarmState');

// BL-079: a ticket whose parcel has left every stage inbox (dropped after a
// stage completed it and never forwarded it, or never routed anywhere at
// all) must render identically on BOTH surfaces from the SAME resolver
// result: the backlog row shows "queued" and no tile shows a badge for it.
// The reported incident had the backlog row show "cleaner" (the last stage
// to finish) while the tile badge showed "coder" (the static assignee) —
// two different wrong answers for one ticket. Root cause (confirmed): the
// backlog row already never falls back past findLiveHolder (fixed under
// BL-072); the tile badge (badgeSummary.ts's buildBadgeMap) did fall back to
// the static assignedTo YAML field when findLiveHolder resolved to null.
// These tests render the REAL webview shell + REAL media/panel.js in jsdom
// and drive the REAL findLiveHolder/buildBadgeMap resolver against a real
// filesystem fixture, not a hand-copied restatement of either.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-holderless-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRolesTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles
    .map((r) => [r.role, 'session', r.worktreePath, `swarmforge-${r.role}`, r.displayName, 'claude', 'task'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function dropHandoff(worktreePath, subdir, filename, content) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', subdir);
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), content);
}

function backlogRowAssignee(document, id) {
  const rows = [...document.querySelectorAll('.backlog-row')];
  const row = rows.find((r) => r.querySelector('.bl-id').textContent === id);
  const assigned = row && row.querySelector('.bl-assigned');
  return assigned ? assigned.textContent : null;
}

function tileBadgeText(document, role) {
  const tile = document.querySelector(`.tile[data-role="${role}"]`);
  const badge = tile && tile.querySelector('.tile-bl-badge');
  return badge ? badge.textContent : '';
}

// Mirrors swarmPanel.ts's own holderMap loop exactly (same resolver call,
// no per-surface fork) so the test drives both surfaces the way production
// actually does.
function buildHolderMap(items, targetPath) {
  const holders = {};
  for (const item of items) {
    if (item.status === 'active') {
      const holder = findLiveHolder(targetPath, item.id);
      if (holder) {
        holders[item.id] = holder;
      }
    }
  }
  return holders;
}

function renderState(items, roleList, targetPath) {
  const { document, dispatch } = renderPanel();
  dispatch({ type: 'roles', roles: roleList });
  dispatch({ type: 'backlogUpdate', items });
  dispatch({ type: 'holderUpdate', holders: buildHolderMap(items, targetPath) });
  dispatch({ type: 'badgeUpdate', badges: buildBadgeMap(items, targetPath) });
  return document;
}

// BL-079 holderless-agreement-01 / holderless-agreement-03
test('the reported incident state renders consistently: dropped-after-completion shows queued and no badge on either surface', () => {
  const target = mkTmp();
  const cleanerWt = mkTmp();
  writeRolesTsv(target, [
    { role: 'coder', worktreePath: mkTmp(), displayName: 'Coder' },
    { role: 'cleaner', worktreePath: cleanerWt, displayName: 'Cleaner' },
  ]);
  // The recorded 2026-07-02 state: cleaner completed the parcel and never
  // forwarded it, so its only trace anywhere is inbox/completed/.
  dropHandoff(cleanerWt, 'completed', '00_test.handoff', 'from: coder\nto: cleaner\ntask: bl-079-holderless\ncommit: abc\n');

  const items = [{ id: 'BL-079', title: 'holderless ticket', status: 'active', assignedTo: 'coder' }];
  const document = renderState(items, [
    { role: 'coder', displayName: 'Coder', agent: 'claude' },
    { role: 'cleaner', displayName: 'Cleaner', agent: 'claude' },
  ], target);

  assert.equal(backlogRowAssignee(document, 'BL-079'), 'queued', 'the backlog row must not show "cleaner"');
  assert.equal(tileBadgeText(document, 'coder'), '', 'the coder tile must not resurface the assignee as a phantom holder');
  assert.equal(tileBadgeText(document, 'cleaner'), '', 'the cleaner tile must not show a badge for a completed, un-forwarded parcel');
});

// BL-079 holderless-agreement-02
test('a never-routed active ticket shows queued and no tile badge on both surfaces', () => {
  const target = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: mkTmp(), displayName: 'Coder' }]);

  const items = [{ id: 'BL-080', title: 'never routed', status: 'active', assignedTo: 'coder' }];
  const document = renderState(items, [{ role: 'coder', displayName: 'Coder', agent: 'claude' }], target);

  assert.equal(backlogRowAssignee(document, 'BL-080'), 'queued');
  assert.equal(tileBadgeText(document, 'coder'), '');
});

// BL-079 holderless-agreement-04
test('held and never-routed tickets keep shipped behavior in the same render as a holderless ticket', () => {
  const target = mkTmp();
  const cleanerWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: mkTmp(), displayName: 'Coder' }, { role: 'cleaner', worktreePath: cleanerWt, displayName: 'Cleaner' }]);
  dropHandoff(cleanerWt, 'new', '00_test.handoff', 'from: coder\nto: cleaner\ntask: bl-081-held\ncommit: abc\n');

  const items = [
    { id: 'BL-081', title: 'held ticket', status: 'active', assignedTo: 'coder' },
    { id: 'BL-082', title: 'never routed ticket', status: 'active', assignedTo: 'coder' },
  ];
  const document = renderState(items, [
    { role: 'coder', displayName: 'Coder', agent: 'claude' },
    { role: 'cleaner', displayName: 'Cleaner', agent: 'claude' },
  ], target);

  assert.equal(backlogRowAssignee(document, 'BL-081'), 'cleaner', 'the held ticket keeps its holder on the backlog row');
  assert.match(tileBadgeText(document, 'cleaner'), /BL-081/, 'the held ticket keeps its holder on the tile badge');
  assert.equal(backlogRowAssignee(document, 'BL-082'), 'queued', 'the never-routed ticket shows queued');
  assert.equal(tileBadgeText(document, 'coder'), '', 'the never-routed ticket shows no badge (no assignee fallback)');
});
