/**
 * BL-143: coordinator-facing queue visibility defaults to real .handoff
 * payloads only; sidecars (.chase.json/.nudge) are hidden unless debug is
 * requested. Sidecar files are never touched here - this is observability
 * filtering, not deletion.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSidecars, computeRoleQueueView } = require('../out/swarm/inboxVisibility');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-inbox-visibility-'));
}

function writeHandoff(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'id: t\nfrom: a\nto: b\npriority: 50\ntype: note\n\nbody\n');
}

function writeSidecar(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '{}');
}

// ── listSidecars ─────────────────────────────────────────────────────────

test('listSidecars returns an empty list for a directory with only .handoff files', () => {
  const dir = mkTmp();
  writeHandoff(dir, '00_a.handoff');
  assert.deepEqual(listSidecars(dir), []);
});

test('listSidecars classifies .chase.json and .nudge sidecars by kind', () => {
  const dir = mkTmp();
  writeHandoff(dir, '00_a.handoff');
  writeSidecar(dir, '00_a.handoff.chase.json');
  writeSidecar(dir, '00_b.handoff.nudge');

  const sidecars = listSidecars(dir).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(sidecars, [
    { name: '00_a.handoff.chase.json', kind: 'chase-sidecar' },
    { name: '00_b.handoff.nudge', kind: 'nudge-sidecar' },
  ]);
});

test('listSidecars returns [] for a missing directory rather than throwing', () => {
  assert.deepEqual(listSidecars(path.join(mkTmp(), 'does-not-exist')), []);
});

// ── computeRoleQueueView: BL-143 inbox-visibility-01 ────────────────────────

test('BL-143 inbox-visibility-01: default mode counts/lists only .handoff payloads, sidecars excluded', () => {
  const target = mkTmp();
  const inboxNew = path.join(target, 'inbox', 'new');
  const inProcess = path.join(target, 'inbox', 'in_process');
  writeHandoff(inboxNew, '00_a.handoff');
  writeSidecar(inboxNew, '00_a.handoff.chase.json');
  writeSidecar(inboxNew, '00_b.handoff.nudge');

  const view = computeRoleQueueView('coder', inboxNew, inProcess, false);

  assert.deepEqual(view.payloads, ['00_a.handoff']);
  assert.deepEqual(view.sidecars, []);
});

// ── BL-143 inbox-visibility-02: debug mode reveals sidecars with labels ────

test('BL-143 inbox-visibility-02: debug mode reveals sidecars with explicit kind labels', () => {
  const target = mkTmp();
  const inboxNew = path.join(target, 'inbox', 'new');
  const inProcess = path.join(target, 'inbox', 'in_process');
  writeHandoff(inboxNew, '00_a.handoff');
  writeSidecar(inboxNew, '00_a.handoff.chase.json');

  const view = computeRoleQueueView('coder', inboxNew, inProcess, true);

  assert.deepEqual(view.payloads, ['00_a.handoff']);
  assert.deepEqual(view.sidecars, [{ name: '00_a.handoff.chase.json', kind: 'chase-sidecar' }]);
});

// ── BL-143 inbox-visibility-03: no false busy signal from a sidecar-only inbox ─

test('BL-143 inbox-visibility-03: a sidecar-only inbox (no .handoff) reports zero pending payloads', () => {
  const target = mkTmp();
  const inboxNew = path.join(target, 'inbox', 'new');
  const inProcess = path.join(target, 'inbox', 'in_process');
  writeSidecar(inboxNew, 'orphaned.handoff.nudge');

  const view = computeRoleQueueView('coder', inboxNew, inProcess, false);

  assert.deepEqual(view.payloads, []);
  assert.equal(view.payloads.length, 0, 'a sidecar-only inbox must never read as pending work');
});

test('computeRoleQueueView also covers in_process payloads and sidecars, not just inbox/new', () => {
  const target = mkTmp();
  const inboxNew = path.join(target, 'inbox', 'new');
  const inProcess = path.join(target, 'inbox', 'in_process');
  writeHandoff(inProcess, '00_c.handoff');
  writeSidecar(inProcess, '00_c.handoff.nudge');

  const defaultView = computeRoleQueueView('coder', inboxNew, inProcess, false);
  assert.deepEqual(defaultView.payloads, ['00_c.handoff']);

  const debugView = computeRoleQueueView('coder', inboxNew, inProcess, true);
  assert.deepEqual(debugView.sidecars, [{ name: '00_c.handoff.nudge', kind: 'nudge-sidecar' }]);
});

test('computeRoleQueueView reports zero payloads without error against entirely missing inbox dirs', () => {
  const target = mkTmp();
  const view = computeRoleQueueView('coder', path.join(target, 'new'), path.join(target, 'in_process'), false);
  assert.deepEqual(view.payloads, []);
  assert.deepEqual(view.sidecars, []);
});
