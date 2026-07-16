const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { epicTopicMapPath, readEpicTopicMap } = require('../out/concierge/epicTopicMapStore');

// BL-449: the human-provided epic-id -> Telegram-topic-id map for the three
// pre-existing, hand-created epic topics - a machine-local, gitignored,
// human/operator-authored input (mirrors backlogTopicMapStore.ts's own
// read-with-empty-default shape, but this file is never written by the
// swarm itself - only ever read).

function mkTmp() {
  return mkTmpDir('sfvc-epic-topic-map-');
}

test('readEpicTopicMap returns the parsed map when the file exists', () => {
  const target = mkTmp();
  fs.mkdirSync(path.dirname(epicTopicMapPath(target)), { recursive: true });
  fs.writeFileSync(epicTopicMapPath(target), JSON.stringify({ 'role-benchmarking': 147, 'dynamic-routing': 149 }));

  assert.deepEqual(readEpicTopicMap(target), { 'role-benchmarking': 147, 'dynamic-routing': 149 });
});

test('readEpicTopicMap returns an empty map when the file does not exist', () => {
  const target = mkTmp();
  assert.deepEqual(readEpicTopicMap(target), {});
});

test('readEpicTopicMap returns an empty map for corrupt JSON, never throws', () => {
  const target = mkTmp();
  fs.mkdirSync(path.dirname(epicTopicMapPath(target)), { recursive: true });
  fs.writeFileSync(epicTopicMapPath(target), 'not json');

  assert.doesNotThrow(() => readEpicTopicMap(target));
  assert.deepEqual(readEpicTopicMap(target), {});
});

test('epicTopicMapPath resolves under .swarmforge/operator/', () => {
  const target = mkTmp();
  assert.equal(epicTopicMapPath(target), path.join(target, '.swarmforge', 'operator', 'epic-topic-map.json'));
});
