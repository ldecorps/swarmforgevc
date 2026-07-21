const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ALL_SWARM_ROLES, roleTopicMapPath, readRoleTopicMap, writeRoleTopicMap, roleForTopic } = require('../out/concierge/roleTopicMapStore');

// BL-425 slice 1: the machine-local role->Telegram-topic-id map, mirroring
// backlogTopicMapStore.test.js's own path/read/write coverage (that store
// has no dedicated test file of its own - it is exercised indirectly via
// telegramFrontDeskBotCli.test.js/conciergeTopicRouting.test.js - so this
// file is the direct unit coverage for the new sibling store).

function mkTmp() {
  return mkTmpDir('sfvc-role-topic-map-');
}

// ── ALL_SWARM_ROLES ───────────────────────────────────────────────────────

test('ALL_SWARM_ROLES lists exactly the 8 swarm roles, coordinator included', () => {
  assert.deepEqual(ALL_SWARM_ROLES, ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator']);
});

// ── roleTopicMapPath / readRoleTopicMap / writeRoleTopicMap ──────────────

test('roleTopicMapPath resolves under .swarmforge/operator/, sibling to the other operator-owned maps', () => {
  assert.equal(roleTopicMapPath('/some/target'), path.join('/some/target', '.swarmforge', 'operator', 'role-topic-map.json'));
});

test('readRoleTopicMap returns an empty map when the file does not exist yet, never a crash', () => {
  const root = mkTmp();
  assert.deepEqual(readRoleTopicMap(root), {});
});

test('readRoleTopicMap returns an empty map for a corrupt/unparsable file rather than throwing', () => {
  const root = mkTmp();
  fs.mkdirSync(path.dirname(roleTopicMapPath(root)), { recursive: true });
  fs.writeFileSync(roleTopicMapPath(root), 'not json');
  assert.deepEqual(readRoleTopicMap(root), {});
});

test('writeRoleTopicMap persists the map so a subsequent readRoleTopicMap returns it unchanged', () => {
  const root = mkTmp();
  writeRoleTopicMap(root, { coder: 42, QA: 55 });
  assert.deepEqual(readRoleTopicMap(root), { coder: 42, QA: 55 });
});

test('writeRoleTopicMap creates the .swarmforge/operator/ directory on first write', () => {
  const root = mkTmp();
  assert.equal(fs.existsSync(path.dirname(roleTopicMapPath(root))), false);
  writeRoleTopicMap(root, { coder: 1 });
  assert.equal(fs.existsSync(roleTopicMapPath(root)), true);
});

// ── roleForTopic (pure inverse lookup) ───────────────────────────────────

test('roleForTopic resolves a mapped topic id to its role', () => {
  assert.equal(roleForTopic({ coder: 42, QA: 55 }, 42), 'coder');
});

test('roleForTopic returns undefined for an unmapped topic id, never a crash', () => {
  assert.equal(roleForTopic({ coder: 42 }, 999), undefined);
});

test('roleForTopic returns undefined for an undefined topic id (a DM, no real topic)', () => {
  assert.equal(roleForTopic({ coder: 42 }, undefined), undefined);
});

test('roleForTopic resolves each role to ITS OWN topic, not another role\'s, when several are mapped', () => {
  const map = { coder: 42, cleaner: 43, QA: 44 };
  assert.equal(roleForTopic(map, 42), 'coder');
  assert.equal(roleForTopic(map, 43), 'cleaner');
  assert.equal(roleForTopic(map, 44), 'QA');
});
