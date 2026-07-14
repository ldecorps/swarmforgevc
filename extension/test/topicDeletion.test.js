const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decideTopicDeletion, sweepTopicDeletions, topicRetentionWindowMs } = require('../out/concierge/topicDeletion');
const { completionSummaryText } = require('../out/concierge/topicRouter');
const { readRecord } = require('../out/concierge/blTopicStore');

// BL-331: slice 3 of archive-then-delete - a done ticket's topic is only
// ever deleted after its content is VERIFIED serialised into the repo, and
// only once outside the retention window. Mirrors BL-299's own "close only
// follows a successful post, never an attempted one" ordering discipline
// for the far less reversible delete verb.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * ONE_DAY_MS;

function ticket(overrides = {}) {
  return { id: 'BL-900', title: 'a fine feature', ...overrides };
}

function summaryFor(t) {
  return completionSummaryText({ type: 'TaskCompleted', backlogId: t.id, payload: {} }, t.title);
}

function verifiedRecord(t, completedAtMs) {
  return { id: t.id, messages: [{ seq: 0, ts: completedAtMs, author: 'swarm', type: 'outbound', text: summaryFor(t) }] };
}

function emptyRecord(t) {
  return { id: t.id, messages: [] };
}

// ── decideTopicDeletion (pure) ──────────────────────────────────────────

// BL-331 archive-then-delete-01
test('a topic with a verified record, outside the retention window, is deleted', () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS;
  const record = verifiedRecord(t, 0);
  const decision = decideTopicDeletion(t, { [t.id]: 42 }, record, now, RETENTION_MS);
  assert.deepEqual(decision, { action: 'delete', topicId: 42 });
});

test('the record is verified before any deletion is attempted - an unverified record never reaches delete, however old', () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS * 100;
  const decision = decideTopicDeletion(t, { [t.id]: 42 }, emptyRecord(t), now, RETENTION_MS);
  assert.notEqual(decision.action, 'delete');
});

// BL-331 archive-then-delete-02 / 05
test('a missing/incomplete serialised record keeps the topic (never delete on an attempted-but-unverified archive)', () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS;
  const decision = decideTopicDeletion(t, { [t.id]: 42 }, emptyRecord(t), now, RETENTION_MS);
  assert.deepEqual(decision, { action: 'keep', reason: 'unverified' });
});

test('a record with unrelated messages but no verified completion text keeps the topic', () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS;
  const record = { id: t.id, messages: [{ seq: 0, ts: 0, author: 'human', type: 'inbound', text: 'a question' }] };
  const decision = decideTopicDeletion(t, { [t.id]: 42 }, record, now, RETENTION_MS);
  assert.deepEqual(decision, { action: 'keep', reason: 'unverified' });
});

// BL-331 archive-then-delete-04
test('a verified record still inside the retention window keeps the topic', () => {
  const t = ticket();
  const completedAt = 1000;
  const now = completedAt + RETENTION_MS - 1;
  const decision = decideTopicDeletion(t, { [t.id]: 42 }, verifiedRecord(t, completedAt), now, RETENTION_MS);
  assert.deepEqual(decision, { action: 'keep', reason: 'retention-window' });
});

test('the retention window boundary is inclusive - exactly the window elapsed is eligible for deletion', () => {
  const t = ticket();
  const completedAt = 1000;
  const now = completedAt + RETENTION_MS;
  const decision = decideTopicDeletion(t, { [t.id]: 42 }, verifiedRecord(t, completedAt), now, RETENTION_MS);
  assert.deepEqual(decision, { action: 'delete', topicId: 42 });
});

test('a completed ticket with no topic ever mapped is left alone - never deletes something that does not exist', () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS;
  const decision = decideTopicDeletion(t, {}, verifiedRecord(t, 0), now, RETENTION_MS);
  assert.deepEqual(decision, { action: 'keep', reason: 'no-topic' });
});

// ── sweepTopicDeletions (adapter-injected) ──────────────────────────────

function fakeAdapters({ topicMap = {}, records = {} } = {}) {
  const deletedCalls = [];
  const dropped = [];
  const reportedUnverified = [];
  return {
    dropped,
    reportedUnverified,
    deletedCalls,
    adapters: {
      getTopicMap: () => topicMap,
      readRecord: (ticketId) => records[ticketId] ?? { id: ticketId, messages: [] },
      deleteTopic: async (topicId) => {
        deletedCalls.push(topicId);
        return true;
      },
      dropTopicMapping: (backlogId) => {
        dropped.push(backlogId);
      },
      reportUnverifiedDeletion: (ticketId) => {
        reportedUnverified.push(ticketId);
      },
    },
  };
}

// BL-331 archive-then-delete-03
test('a deleted topic has its mapping dropped, and is reported in the sweep result', async () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS;
  const { adapters, dropped, deletedCalls } = fakeAdapters({ topicMap: { [t.id]: 42 }, records: { [t.id]: verifiedRecord(t, 0) } });
  const result = await sweepTopicDeletions([t], adapters, now, RETENTION_MS);
  assert.deepEqual(result, { deleted: [t.id] });
  assert.deepEqual(dropped, [t.id]);
  assert.deepEqual(deletedCalls, [42]);
});

test('an unverified, eligible-by-age ticket is never deleted and is reported loudly', async () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS;
  const { adapters, dropped, deletedCalls, reportedUnverified } = fakeAdapters({ topicMap: { [t.id]: 42 }, records: {} });
  const result = await sweepTopicDeletions([t], adapters, now, RETENTION_MS);
  assert.deepEqual(result, { deleted: [] });
  assert.deepEqual(dropped, []);
  assert.deepEqual(deletedCalls, []);
  assert.deepEqual(reportedUnverified, [t.id]);
});

test('a ticket inside the retention window is never deleted and is NOT reported as unverified (ordinary, expected wait state)', async () => {
  const t = ticket();
  const completedAt = 1000;
  const now = completedAt + 1;
  const { adapters, dropped, deletedCalls, reportedUnverified } = fakeAdapters({
    topicMap: { [t.id]: 42 },
    records: { [t.id]: verifiedRecord(t, completedAt) },
  });
  const result = await sweepTopicDeletions([t], adapters, now, RETENTION_MS);
  assert.deepEqual(result, { deleted: [] });
  assert.deepEqual(dropped, []);
  assert.deepEqual(deletedCalls, []);
  assert.deepEqual(reportedUnverified, [], 'a within-window wait is expected, not an anomaly worth surfacing');
});

test('a failed deleteTopic call leaves the mapping and record untouched, retried on a later sweep', async () => {
  const t = ticket();
  const now = RETENTION_MS + ONE_DAY_MS;
  const { adapters, dropped } = fakeAdapters({ topicMap: { [t.id]: 42 }, records: { [t.id]: verifiedRecord(t, 0) } });
  adapters.deleteTopic = async () => false;
  const result = await sweepTopicDeletions([t], adapters, now, RETENTION_MS);
  assert.deepEqual(result, { deleted: [] });
  assert.deepEqual(dropped, [], 'expected no mapping drop when the delete itself failed');
});

test('multiple done tickets are each swept independently, in order', async () => {
  const a = ticket({ id: 'BL-1', title: 'first' });
  const b = ticket({ id: 'BL-2', title: 'second' });
  const now = RETENTION_MS + ONE_DAY_MS;
  const { adapters, dropped } = fakeAdapters({
    topicMap: { 'BL-1': 10, 'BL-2': 20 },
    records: { 'BL-1': verifiedRecord(a, 0), 'BL-2': verifiedRecord(b, 0) },
  });
  const result = await sweepTopicDeletions([a, b], adapters, now, RETENTION_MS);
  assert.deepEqual(result, { deleted: ['BL-1', 'BL-2'] });
  assert.deepEqual(dropped, ['BL-1', 'BL-2']);
});

// ── real, induced (never mocked) archive-read failure ───────────────────
// BL-331's own E2E QA note: "INDUCE A REAL ARCHIVE WRITE FAILURE ... assert
// the deletion DOES NOT HAPPEN and the failure is loud" - forcing a
// directory at the exact record path (EISDIR) is the established, portable
// technique this repo already uses (backlogReader.test.js) instead of
// chmod, which root/WSL can silently ignore (BL-219).
function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-topic-deletion-'));
}

test('a genuinely unreadable record (real EISDIR, not mocked) is treated as unverified and blocks deletion loudly', async () => {
  const t = ticket({ id: 'BL-777' });
  const targetPath = mkTmp();
  const recordFilePath = path.join(targetPath, 'backlog', 'topics', `${t.id}.json`);
  fs.mkdirSync(recordFilePath, { recursive: true }); // a directory where a file is expected -> real EISDIR on read

  const now = RETENTION_MS + ONE_DAY_MS;
  const { adapters, dropped, deletedCalls, reportedUnverified } = fakeAdapters({ topicMap: { [t.id]: 42 } });
  adapters.readRecord = (ticketId) => readRecord(targetPath, ticketId); // the REAL readRecord, hitting the REAL broken path

  const result = await sweepTopicDeletions([t], adapters, now, RETENTION_MS);

  assert.deepEqual(result, { deleted: [] });
  assert.deepEqual(dropped, []);
  assert.deepEqual(deletedCalls, []);
  assert.deepEqual(reportedUnverified, [t.id]);
});

// ── topicRetentionWindowMs (env-var-with-numeric-default, same shape as
//    conciergeTickIntervalMs) ────────────────────────────────────────────

test('topicRetentionWindowMs defaults to 7 days when unset', () => {
  assert.equal(topicRetentionWindowMs(undefined), 7 * ONE_DAY_MS);
});

test('topicRetentionWindowMs uses a valid positive override', () => {
  assert.equal(topicRetentionWindowMs('60000'), 60000);
});

test('topicRetentionWindowMs falls back to the default on an invalid or non-positive override', () => {
  assert.equal(topicRetentionWindowMs('not-a-number'), 7 * ONE_DAY_MS);
  assert.equal(topicRetentionWindowMs('0'), 7 * ONE_DAY_MS);
  assert.equal(topicRetentionWindowMs('-5'), 7 * ONE_DAY_MS);
});
