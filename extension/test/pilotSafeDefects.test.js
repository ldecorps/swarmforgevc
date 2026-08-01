const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  listSafePilotDefects,
  pickSafePilotDefect,
  formatSafePilotListMessage,
} = require('../out/tools/pilotSafeDefects');
const { parsePilotSafeCommand, parsePilotTicket } = require('../out/tools/telegramCursorBridgePilot');

function writeTicket(root, folder, id, fields) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    `id: ${id}`,
    `title: "${fields.title || id}"`,
    `type: ${fields.type || 'defect'}`,
    `status: ${fields.status || 'todo'}`,
    `severity: ${fields.severity || 'medium'}`,
    `priority: ${fields.priority ?? 10}`,
    `human_approval: ${fields.human_approval || 'approved'}`,
    `mutation_cost: ${fields.mutation_cost || 'low'}`,
    `acceptance: specs/features/${id}-x.feature`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${id}.yaml`), body);
  if (fields.withFeature !== false) {
    const featDir = path.join(root, 'specs', 'features');
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(featDir, `${id}-x.feature`), `Feature: ${id}\n`);
  }
}

test('parsePilotSafeCommand recognizes list and start', () => {
  assert.deepEqual(parsePilotSafeCommand('/pilot safe'), { kind: 'start' });
  assert.deepEqual(parsePilotSafeCommand('/pilot safe --list'), { kind: 'list' });
  assert.deepEqual(parsePilotSafeCommand('/pilot safe list'), { kind: 'list' });
  assert.equal(parsePilotSafeCommand('/pilot BL-700'), undefined);
  assert.equal(parsePilotTicket('/pilot safe'), undefined);
  assert.equal(parsePilotTicket('/pilot BL-700'), 'BL-700');
  assert.deepEqual(parsePilotSafeCommand('/PILOT SAFE'), { kind: 'start' });
});

test('listSafePilotDefects filters and ranks', () => {
  const root = mkTmpDir('sf-safe-');
  writeTicket(root, 'paused', 'BL-100', {
    title: 'low sev',
    severity: 'low',
    priority: 1,
    mutation_cost: 'low',
  });
  writeTicket(root, 'paused', 'BL-200', {
    title: 'high sev',
    severity: 'high',
    priority: 50,
    mutation_cost: 'low',
  });
  writeTicket(root, 'paused', 'BL-300', {
    title: 'medium mut',
    severity: 'high',
    priority: 1,
    mutation_cost: 'medium',
  });
  writeTicket(root, 'paused', 'BL-400', {
    title: 'needs design',
    severity: 'high',
    priority: 1,
    mutation_cost: 'low',
    status: 'needs_design',
  });
  writeTicket(root, 'paused', 'BL-500', {
    title: 'no feature',
    severity: 'high',
    priority: 1,
    mutation_cost: 'low',
    withFeature: false,
  });
  const listed = listSafePilotDefects(root);
  assert.deepEqual(
    listed.tickets.map((t) => t.id),
    ['BL-200', 'BL-100']
  );
  const picked = pickSafePilotDefect(root);
  assert.equal(picked.ticket.id, 'BL-200');
  assert.match(picked.rationale, /Safe filter matched 2/);
  assert.match(formatSafePilotListMessage(listed), /BL-200/);
});

test('empty safe pool', () => {
  const root = mkTmpDir('sf-safe-empty-');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  const listed = listSafePilotDefects(root);
  assert.equal(listed.tickets.length, 0);
  assert.match(listed.reasonEmpty || '', /No paused defects/);
  const picked = pickSafePilotDefect(root);
  assert.equal(picked.empty, true);
});
