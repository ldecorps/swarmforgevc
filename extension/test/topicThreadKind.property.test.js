const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  classifyTopicThread,
  mayWriteTrackedTopicRecord,
  retireTrackedSupervisorRecords,
} = require('../out/concierge/topicThreadKind');
const {
  readSwarmIconId,
  recordSwarmIconId,
  recordPath,
} = require('../out/concierge/blTopicStore');

// BL-695 declared invariants:
// 1. No thread the concierge cannot bind to a ticket ever produces a
//    git-tracked write (fail closed to silence).
// 2. Exempting a thread from the tracked record never exempts it from
//    remembering the swarm icon it already set (untracked store / migrate).
//
// Runs ONLY via `npm run test:properties`.

const SILENT = () => {};

function mkRoot() {
  return mkTmpDir('sfvc-bl695-prop-');
}

test('property (invariant 1): only BL-/GH- ids may write tracked records', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ min: 1, max: 9999 }).map((n) => `BL-${n}`),
        fc.integer({ min: 1, max: 9999 }).map((n) => `GH-${n}`),
        fc.integer({ min: 1, max: 99 }).map((n) => `SUP-${n}`),
        fc.stringMatching(/^[A-Z]{2,8}-\d{1,4}$/),
        fc.constantFrom('Operator', 'front-desk', 'mystery', '')
      ),
      (id) => {
        const kind = classifyTopicThread(id);
        const may = mayWriteTrackedTopicRecord(id);
        if (kind === 'ticket') {
          assert.equal(may, true);
        } else {
          assert.equal(may, false);
        }
      }
    ),
    { numRuns: 100 }
  );
});

test('property (invariant 2): supervisor icon memory survives without a tracked record', () => {
  let cases = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 99 }).map((n) => `SUP-${n}`),
      fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0),
      (threadId, iconId) => {
        cases += 1;
        const root = mkRoot();
        try {
          recordSwarmIconId(root, threadId, iconId, SILENT, SILENT);
          assert.equal(fs.existsSync(recordPath(root, threadId)), false);
          assert.equal(readSwarmIconId(root, threadId), iconId);
          // "Restart": fresh reads of the same untracked store.
          assert.equal(readSwarmIconId(root, threadId), iconId);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 40 }
  );
  assert.ok(cases > 0);
});

test('property (invariant 2): retiring legacy SUP records migrates icons off tracked topics', () => {
  let cases = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 99 }).map((n) => `SUP-${n}`),
      fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0),
      (threadId, iconId) => {
        cases += 1;
        const root = mkRoot();
        const topics = path.join(root, 'backlog', 'topics');
        try {
          fs.mkdirSync(topics, { recursive: true });
          fs.writeFileSync(
            path.join(topics, `${threadId}.json`),
            JSON.stringify({ id: threadId, messages: [], swarmIconId: iconId })
          );
          retireTrackedSupervisorRecords(root, topics);
          assert.equal(fs.existsSync(path.join(topics, `${threadId}.json`)), false);
          assert.equal(readSwarmIconId(root, threadId), iconId);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 30 }
  );
  assert.ok(cases > 0);
});
