'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  classifyCursorHostRouting,
  computeScrubCandidates,
  probeLegacyTopicAdoption,
  formatProbeReport,
  assertReadableTargetPath,
} = require('../out/tools/probeLegacyTopicAdoption');
const { openSubjectAndRecord } = require('../out/tools/telegram-front-desk-bot');
const { OPERATOR_SUBJECT_ID } = require('../out/tools/telegramFrontDeskBotCore');

function mkRoot() {
  return mkTmpDir('sfvc-bl1147-');
}

function writeBacklogTopicMap(root, map) {
  const dir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog-topic-map.json'), JSON.stringify(map));
}

function writeTopicMap(root, map) {
  const dir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram-topic-map.json'), JSON.stringify(map));
}

function writeCursorBridgeState(root, state) {
  const dir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cursor-bridge-state.json'), JSON.stringify(state));
}

function writeSwarmEnv(root, body) {
  const dir = path.join(root, '.swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'swarm.env'), body);
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function backlogTopicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json');
}

test('classifyCursorHostRouting maps provider to bridge vs operator-re-adopt', () => {
  assert.equal(classifyCursorHostRouting(8435, 'cursor'), 'bridge');
  assert.equal(classifyCursorHostRouting(8435, ''), 'bridge');
  assert.equal(classifyCursorHostRouting(8435, 'local'), 'operator-re-adopt');
  assert.equal(classifyCursorHostRouting(8435, 'openai'), 'operator-re-adopt');
  assert.equal(classifyCursorHostRouting(undefined, 'local'), 'unbound');
});

test('computeScrubCandidates lists only keys frontDeskTopicMapWithoutCursorBridge would strip', () => {
  assert.deepEqual(computeScrubCandidates({ '9001': 'SUP-12', '42': 'OPERATOR' }, 9001, undefined), ['9001']);
  assert.deepEqual(computeScrubCandidates({ '42': 'OPERATOR' }, 9001, undefined), []);
});

test('probeLegacyTopicAdoption lists legacy per-ticket BL keys read-only', () => {
  const root = mkRoot();
  writeBacklogTopicMap(root, { 'BL-101': 11, 'BL-202': 22, 'topic-consolidation': 99 });
  const before = fs.readFileSync(backlogTopicMapPath(root), 'utf8');
  const report = probeLegacyTopicAdoption(root);
  assert.deepEqual(
    report.legacyPerTicketTopics.map((e) => e.backlogId).sort(),
    ['BL-101', 'BL-202']
  );
  assert.equal(fs.readFileSync(backlogTopicMapPath(root), 'utf8'), before);
});

test('probeLegacyTopicAdoption classifies cursor Host routing from provider', () => {
  const root = mkRoot();
  writeCursorBridgeState(root, { cursorTopicId: 8435 });
  writeSwarmEnv(root, 'export SWARMFORGE_LETS_TALK_PROVIDER=local\n');
  const report = probeLegacyTopicAdoption(root);
  assert.equal(report.cursorHostTopicId, 8435);
  assert.equal(report.cursorHostRouting, 'operator-re-adopt');
});

test('probeLegacyTopicAdoption flags stale front-desk bindings as scrub candidates without writing', () => {
  const root = mkRoot();
  writeCursorBridgeState(root, { cursorTopicId: 9001 });
  writeTopicMap(root, { '9001': 'SUP-12' });
  const before = fs.readFileSync(topicMapPath(root), 'utf8');
  const report = probeLegacyTopicAdoption(root);
  assert.deepEqual(report.scrubCandidates, ['9001']);
  assert.equal(fs.readFileSync(topicMapPath(root), 'utf8'), before);
});

test('BL-1147: openSubjectAndRecord re-adopts cursor Host topic into OPERATOR when provider is not cursor', async () => {
  const root = mkRoot();
  writeCursorBridgeState(root, { cursorTopicId: 7001 });
  writeSwarmEnv(root, 'export SWARMFORGE_LETS_TALK_PROVIDER=local\n');
  const subjectId = await openSubjectAndRecord(root, 7001, 'hello operator', 42);
  assert.equal(subjectId, OPERATOR_SUBJECT_ID);
  const map = JSON.parse(fs.readFileSync(topicMapPath(root), 'utf8'));
  assert.equal(map['7001'], OPERATOR_SUBJECT_ID);
  assert.equal(Object.keys(map).some((k) => k.startsWith('SUP-')), false);
});

test('BL-1147: openSubjectAndRecord refuses cursor Host topic when cursor routing is enabled', async () => {
  const root = mkRoot();
  writeCursorBridgeState(root, { cursorTopicId: 7002 });
  writeSwarmEnv(root, 'export SWARMFORGE_LETS_TALK_PROVIDER=cursor\n');
  await assert.rejects(
    () => openSubjectAndRecord(root, 7002, 'hello bridge', 43),
    /owned by telegram-cursor-bridge/
  );
});

test('formatProbeReport renders human-readable lines', () => {
  const lines = formatProbeReport({
    legacyPerTicketTopics: [{ backlogId: 'BL-101', topicId: 11 }],
    cursorHostTopicId: 8435,
    bubbleTopicId: undefined,
    letsTalkProvider: 'local',
    cursorHostRouting: 'operator-re-adopt',
    frontDeskBindingsOnBridgeTopics: [],
    scrubCandidates: [],
  });
  assert.match(lines.join('\n'), /BL-101/);
  assert.match(lines.join('\n'), /operator-re-adopt/);
});

test('assertReadableTargetPath rejects missing directories', () => {
  assert.throws(() => assertReadableTargetPath('/does/not/exist-bl1147'), /not readable/);
});
