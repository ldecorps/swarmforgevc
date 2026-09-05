'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { probeLegacyTopicAdoption, classifyCursorHostRouting } = require('../out/tools/probeLegacyTopicAdoption');
const { writeBacklogTopicMap } = require('../out/concierge/backlogTopicMapStore');

function snapshotFiles(root) {
  const out = {};
  const walk = (dir) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else {
        out[full] = fs.readFileSync(full);
      }
    }
  };
  walk(path.join(root, '.swarmforge'));
  return out;
}

test('property: probeLegacyTopicAdoption never mutates on-disk operator state', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 9999 }), { minLength: 0, maxLength: 4 }), (topicIds) => {
      const root = mkTmpDir('sfvc-bl1147-prop-');
      const map = {};
      topicIds.forEach((id, idx) => {
        map[`BL-${100 + idx}`] = id;
      });
      if (Object.keys(map).length > 0) {
        writeBacklogTopicMap(root, map);
      }
      const before = snapshotFiles(root);
      probeLegacyTopicAdoption(root);
      const after = snapshotFiles(root);
      assert.deepEqual(after, before);
    }),
    { numRuns: 40 }
  );
});

test('property: classifyCursorHostRouting is bridge iff provider is empty or cursor', () => {
  fc.assert(
    fc.property(
      fc.option(fc.integer({ min: 1, max: 99999 }), { nil: undefined }),
      fc.constantFrom('', 'cursor', 'local', 'openai', 'CURSOR', ' OpenAI '),
      (cursorTopicId, provider) => {
        const routing = classifyCursorHostRouting(cursorTopicId, provider);
        if (cursorTopicId === undefined) {
          assert.equal(routing, 'unbound');
          return;
        }
        const normalized = provider.trim().toLowerCase();
        const expectBridge = normalized === '' || normalized === 'cursor';
        assert.equal(routing, expectBridge ? 'bridge' : 'operator-re-adopt');
      }
    ),
    { numRuns: 80 }
  );
});

test('non-vacuity: a broken always-mutate probe would fail the read-only property', () => {
  const root = mkTmpDir('sfvc-bl1147-nonvac-');
  writeBacklogTopicMap(root, { 'BL-1': 1 });
  const before = snapshotFiles(root);
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'probe-touched.txt'), 'x');
  const after = snapshotFiles(root);
  assert.notDeepEqual(before, after);
});
